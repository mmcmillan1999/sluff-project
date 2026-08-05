// backend/src/core/bot-brains/coyoteBrain.js
//
// COYOTE — the attrition brain. (Matt: you asked not to be told the logic;
// stop reading here if you want the blind-tester experience.)
//
// Philosophy: patience and starvation. Where counting cashes what is safe,
// coyote spends the whole early round degrading the opponents' position and
// keeps its control cards for the endgame:
//
//   - As a defender it hunts the bidder's known voids and leads cheap cards
//     into them, forcing trump out of the bidder's hand one junk trick at a
//     time. A bidder stripped of trump cannot stop the defense's late run.
//   - It refuses to spend boss cards on junk: early, low-point tricks are
//     conceded rather than won with a card that controls the endgame.
//   - It builds voids aggressively when discarding — shortest suit first —
//     buying future ruffs.
//   - Once trump is gone (or the round is late), it flips from miser to
//     collector and cashes everything top-down.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER, CARD_POINT_VALUES } = require('../constants');
const { getLegalMoves } = require('../legalMoves');
const { buildPublicView } = require('../bot-strategies/PublicRoundView');
const countingBrain = require('./countingBrain');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const pointValue = (card) => CARD_POINT_VALUES[gameLogic.getRank(card)] || 0;
const lowestBy = (cards, scoreFn) => [...cards].sort((a, b) => scoreFn(a) - scoreFn(b))[0];


const chooseLead = (view, memory, legal) => {
    const trump = view.trumpSuit;

    // Attrition strike: lead a cheap card straight into the bidder's known
    // void while the bidder still holds trump — every ruff we force is one
    // fewer trump guarding their endgame.
    if (!memory.iAmBidder && memory.trumpOut > 0) {
        const bleedLeads = legal.filter(card => {
            const suit = gameLogic.getSuit(card);
            return suit !== trump
                && pointValue(card) === 0
                && memory.knownVoid(view.bidderName, suit)
                && !memory.knownVoid(view.bidderName, trump);
        });
        if (bleedLeads.length > 0) return lowestBy(bleedLeads, rankValue);
    }

    // Bidder tempo: with the boss trump in hand and trump broken, draw.
    if (memory.iAmBidder && memory.trumpOut > 0) {
        const bossTrumps = legal.filter(card => (
            gameLogic.getSuit(card) === trump && memory.isBoss(card)
        ));
        if (bossTrumps.length > 0) return lowestBy(bossTrumps, rankValue);
    }

    // Cash safe bosses richest-first. (v1 held these back early "for the
    // endgame" — 200-game gate said that patience was just lost tempo.)
    const bosses = legal.filter(card => (
        gameLogic.getSuit(card) !== trump && memory.isBoss(card) && memory.safeLater(card)
    ));
    if (bosses.length > 0) {
        return [...bosses].sort((a, b) => (
            (pointValue(b) - pointValue(a)) || (rankValue(b) - rankValue(a))
        ))[0];
    }

    // Quiet exit: prefer suits already broken (no free information, no free
    // tricks in fresh suits), lowest card, shortest suit first.
    const suitLen = (card) => view.myHand
        .filter(c => gameLogic.getSuit(c) === gameLogic.getSuit(card)).length;
    const suitBroken = (card) => memory.outstandingIn(gameLogic.getSuit(card)).length < 6;
    const exits = legal.filter(card => pointValue(card) === 0);
    const pool = exits.length > 0 ? exits : legal;
    return lowestBy(pool, (card) => (
        pointValue(card) * 1000
        + (suitBroken(card) ? 0 : 200)
        + suitLen(card) * 10
        + rankValue(card)
    ));
};

const chooseFollow = (view, memory, legal, engine, bot) => {
    const trump = view.trumpSuit;
    const plays = engine.currentTrickCards;
    const leadSuit = engine.leadSuitCurrentTrick;
    const currentWinner = gameLogic.determineTrickWinner(plays, leadSuit, trump);
    const winnerName = currentWinner?.playerName;
    const winnerIsPartner = memory.partners.includes(winnerName);
    const order = countingBrain.trickOrder(view);
    const behind = order.slice(plays.length + 1);
    const amLast = behind.length === 0;

    if (winnerIsPartner) {
        const winnerCard = currentWinner.card;
        const winnerIsTrump = gameLogic.getSuit(winnerCard) === trump;
        const secure = amLast || (memory.isBoss(winnerCard) && (winnerIsTrump || !behind.some(name => (
            memory.opponents.includes(name)
            && memory.trumpOut > 0
            && !memory.knownVoid(name, trump)
            && (memory.knownVoid(name, leadSuit) || memory.outstandingIn(leadSuit).length === 0)
        ))));
        if (secure) {
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
        // Cheapest sufficient card. (v1 conceded "junk" tricks to preserve
        // control cards; the gate showed every conceded trick was a gift.)
        return lowestBy(winners, rankValue);
    }

    // Concede cheaply, digging voids: shortest suit first, points protected.
    const suitLen = (card) => view.myHand
        .filter(c => gameLogic.getSuit(c) === gameLogic.getSuit(card)).length;
    return lowestBy(legal, (card) => (
        pointValue(card) * 1000
        + suitLen(card) * 20
        + rankValue(card)
    ));
};

const playCard = (engine, bot) => {
    const hand = engine.hands[bot.playerName];
    if (!hand || hand.length === 0) return null;

    const isLeading = engine.currentTrickCards.length === 0;
    const legal = getLegalMoves(hand, isLeading, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    const view = buildPublicView(engine, bot.playerName);
    if (!view) return countingBrain.playCard(engine, bot);

    const memory = countingBrain.buildMemory(view);
    return isLeading
        ? chooseLead(view, memory, legal)
        : chooseFollow(view, memory, legal, engine, bot);
};

module.exports = { playCard };
