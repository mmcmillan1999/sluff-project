// backend/src/core/bot-brains/countingBrain.js
//
// The trial brain: full card-played memory, strictly from public information
// (PublicRoundView — the same no-cheating boundary the insurance market
// uses). What it knows that classic doesn't: every card played so far, which
// suits each opponent has shown themselves void in, which of its cards are
// boss, and how much trump is still out.
//
// Matt's three rules, encoded:
//   1. Win with the CHEAPEST sufficient card — IF the bigger card stays safe
//      to cash later. A big point card in a suit that can be ruffed gets
//      banked now, while it wins, instead of dying in hand.
//   2. Forced to trump under a made trick: OVERRUFF if you can (the king
//      goes over their queen); never bleed a low trump under a trick you
//      could own, and never dump the trump 10 into a trick you are losing.
//   3. Schmear a partner's secure boss from ANY seat, not just the last one.
//
// The "Midnight Special" (running a controlled second suit once trump is
// bled) falls out of the lead logic here mechanically: once no trump is
// outstanding, every boss is safe, and the brain cashes them top-down.
// Recognizing the moment theatrically (song + animation) is backlogged in
// docs/BACKLOG.md.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER, CARD_POINT_VALUES, deck } = require('../constants');
const { getLegalMoves } = require('../legalMoves');
const { buildPublicView } = require('../bot-strategies/PublicRoundView');
const classicBrain = require('./classicBrain');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const pointValue = (card) => CARD_POINT_VALUES[gameLogic.getRank(card)] || 0;
const lowestBy = (cards, scoreFn) => [...cards].sort((a, b) => scoreFn(a) - scoreFn(b))[0];

// Everything the brain derives once per decision from the public view.
const buildMemory = (view) => {
    const seen = new Set([...view.playedSet, ...view.myHand]);
    const outstanding = {};
    for (const card of deck) {
        if (seen.has(card)) continue;
        const suit = gameLogic.getSuit(card);
        (outstanding[suit] = outstanding[suit] || []).push(card);
    }

    const me = view.botName;
    const iAmBidder = view.botIsBidder;
    const opponents = iAmBidder
        ? view.activeNames.filter(name => name !== me)
        : [view.bidderName];
    const partners = iAmBidder
        ? []
        : view.activeNames.filter(name => name !== me && name !== view.bidderName);

    const outstandingIn = (suit) => outstanding[suit] || [];
    const knownVoid = (name, suit) => view.voids[name]?.has(suit) === true;
    // Highest not-yet-seen card of the suit ranks below this card.
    const isBoss = (card) => {
        const suit = gameLogic.getSuit(card);
        const rank = rankValue(card);
        return outstandingIn(suit).every(other => rankValue(other) < rank);
    };
    const trumpOut = outstandingIn(view.trumpSuit).length;

    // Can this card still be cashed safely on a LATER trick? Three dangers:
    // an opponent certainly ruffs (known void + trump possible), everyone is
    // out of the suit, or the suit is thin enough that someone must be void.
    const safeLater = (card) => {
        const suit = gameLogic.getSuit(card);
        if (suit === view.trumpSuit) return true;
        if (trumpOut === 0) return true;
        for (const opp of opponents) {
            if (knownVoid(opp, suit) && !knownVoid(opp, view.trumpSuit)) return false;
        }
        const othersCount = view.activeNames.length - 1;
        if (outstandingIn(suit).length < othersCount) return false;
        return true;
    };

    return { outstandingIn, knownVoid, isBoss, trumpOut, safeLater, opponents, partners, iAmBidder };
};

// Seat order for the current trick, rotated so index 0 is the leader.
const trickOrder = (view) => {
    const leaderIdx = view.activeNames.indexOf(view.trickLeaderName);
    return view.activeNames.map((_, i) => view.activeNames[(leaderIdx + i) % view.n]);
};

const chooseLead = (view, memory, legal) => {
    const trump = view.trumpSuit;

    // Draw trump while holding the boss of it: as bidder always (protect the
    // side suits), as defender when holding more trump than is outstanding.
    if (memory.trumpOut > 0) {
        const bossTrumps = legal.filter(card => (
            gameLogic.getSuit(card) === trump && memory.isBoss(card)
        ));
        const myTrumpCount = view.myHand.filter(c => gameLogic.getSuit(c) === trump).length;
        if (bossTrumps.length > 0 && (memory.iAmBidder || myTrumpCount > memory.trumpOut)) {
            return lowestBy(bossTrumps, rankValue);
        }
    }

    // Cash boss side cards that are safe — richest first. With trump gone
    // this runs a controlled suit top-down (the Midnight Special, minus the
    // song).
    const safeBosses = legal.filter(card => (
        gameLogic.getSuit(card) !== trump && memory.isBoss(card) && memory.safeLater(card)
    ));
    if (safeBosses.length > 0) {
        return [...safeBosses].sort((a, b) => (
            (pointValue(b) - pointValue(a)) || (rankValue(b) - rankValue(a))
        ))[0];
    }

    // Exit low. Never lead a suit where the exit strips the guard off my own
    // 10 while its Ace is still out.
    const stripsMyTenGuard = (card) => {
        const suit = gameLogic.getSuit(card);
        const mine = view.myHand.filter(c => gameLogic.getSuit(c) === suit);
        const holdsVulnerableTen = mine.some(c => gameLogic.getRank(c) === '10')
            && memory.outstandingIn(suit).some(c => gameLogic.getRank(c) === 'A');
        return holdsVulnerableTen && mine.length <= 2;
    };
    const exits = legal.filter(card => pointValue(card) === 0 && !stripsMyTenGuard(card));
    if (exits.length > 0) return lowestBy(exits, rankValue);
    const junk = legal.filter(card => pointValue(card) === 0);
    if (junk.length > 0) return lowestBy(junk, rankValue);
    return lowestBy(legal, (card) => pointValue(card) * 100 + rankValue(card));
};

const chooseFollow = (view, memory, legal, engine, bot) => {
    const trump = view.trumpSuit;
    const plays = engine.currentTrickCards;
    const leadSuit = engine.leadSuitCurrentTrick;
    const currentWinner = gameLogic.determineTrickWinner(plays, leadSuit, trump);
    const winnerName = currentWinner?.playerName;
    const winnerIsPartner = memory.partners.includes(winnerName);
    const order = trickOrder(view);
    const behind = order.slice(plays.length + 1);
    const amLast = behind.length === 0;

    // A partner's card is secure when it is boss for its context and nobody
    // still to act can ruff it. Any seat may schmear onto that — waiting for
    // the last seat leaves 10s unbanked (classic's leak).
    if (winnerIsPartner) {
        const winnerCard = currentWinner.card;
        const winnerIsTrump = gameLogic.getSuit(winnerCard) === trump;
        const bossNow = memory.isBoss(winnerCard);
        const ruffThreatBehind = !winnerIsTrump && behind.some(name => (
            memory.opponents.includes(name)
            && memory.trumpOut > 0
            && !memory.knownVoid(name, trump)
            && (memory.knownVoid(name, leadSuit) || memory.outstandingIn(leadSuit).length === 0)
        ));
        if (amLast || (bossNow && !ruffThreatBehind)) {
            return [...legal].sort((a, b) => (
                (pointValue(b) - pointValue(a)) || (rankValue(a) - rankValue(b))
            ))[0];
        }
    }

    const winners = legal.filter(card => {
        const candidate = [...plays, { card, userId: bot.userId, playerName: bot.playerName }];
        return gameLogic.determineTrickWinner(candidate, leadSuit, trump)?.userId === bot.userId;
    });

    if (winners.length > 0 && !winnerIsPartner) {
        // Cheapest sufficient card wins by default (this is also the
        // overruff: king goes over their queen, never the six under it)...
        let pick = lowestBy(winners, rankValue);
        // ...UNLESS a big point winner cannot be safely cashed later — then
        // bank it now, while it is winning. Only when the win would actually
        // stand: with a known ruffer still to act, "banking" just feeds them.
        const ruffThreatBehind = behind.some(name => (
            memory.opponents.includes(name)
            && memory.trumpOut > 0
            && !memory.knownVoid(name, trump)
            && (memory.knownVoid(name, leadSuit) || memory.outstandingIn(leadSuit).length === 0)
        ));
        if (amLast || !ruffThreatBehind) {
            const endangered = winners
                .filter(card => pointValue(card) >= 10 && !memory.safeLater(card))
                .sort((a, b) => pointValue(b) - pointValue(a));
            if (endangered.length > 0) pick = endangered[0];
        }
        return pick;
    }

    // Cannot (or should not) win: shed the cheapest card, protecting point
    // cards — the trump 10 never dies under a trick we are losing unless it
    // is the only legal card.
    return lowestBy(legal, (card) => (
        pointValue(card) * 100
        + rankValue(card)
        // Prefer exiting from short suits: voids earn future ruffs.
        + view.myHand.filter(c => gameLogic.getSuit(c) === gameLogic.getSuit(card)).length * 2
    ));
};

const playCard = (engine, bot) => {
    const hand = engine.hands[bot.playerName];
    if (!hand || hand.length === 0) return null;

    const isLeading = engine.currentTrickCards.length === 0;
    const legal = getLegalMoves(hand, isLeading, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    // The public view is the memory. If it cannot be built (malformed state),
    // fall back to classic rather than misplay.
    const view = buildPublicView(engine, bot.playerName);
    if (!view) return classicBrain.playCard(engine, bot);

    const memory = buildMemory(view);
    return isLeading
        ? chooseLead(view, memory, legal)
        : chooseFollow(view, memory, legal, engine, bot);
};

// buildMemory/trickOrder are shared infrastructure for sibling brains that
// want the same public-information card memory with different decision
// policies on top.
module.exports = { playCard, buildMemory, trickOrder };
