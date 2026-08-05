// backend/src/core/bot-strategies/PublicRoundView.js
//
// Assembles everything a HUMAN in the bot's seat could know about the round:
// their own hand, the full play history (with seat attribution reconstructed
// from the leader chain, the way a card-counting human would), suit voids
// implied by the follow/trump rules, the revealed Frog widow, and the bot's
// own Frog discards when it is the bidder.
//
// This module is the information boundary for the insurance rollout engine.
// It must never read another player's hand, the face-down widow
// (engine.widow / engine.originalDealtWidow), or another player's Frog
// discards. tests/marketInsurance.test.js enforces this with a trapped engine.

const { getSuit, getRank } = require('../logic');
const { SUITS, RANKS_ORDER } = require('../constants');

const ALL_SUITS = Object.keys(SUITS);

/**
 * Build the public-information view of the current round for one bot.
 * Returns null when the round is not in a state insurance can reason about.
 */
function buildPublicView(engine, botName) {
    const bidWinnerInfo = engine.bidWinnerInfo;
    if (!bidWinnerInfo || !engine.trumpSuit) return null;

    const activeNames = engine.playerOrder.turnOrder
        .map(id => engine.players[id]?.playerName)
        .filter(Boolean);
    const n = activeNames.length;
    if (n < 3 || !activeNames.includes(botName)) return null;

    const bidderName = bidWinnerInfo.playerName;
    const bidType = bidWinnerInfo.bid;
    const trumpSuit = engine.trumpSuit;
    const myHand = [...(engine.hands[botName] || [])];

    // --- Reconstruct completed tricks in play order --------------------
    // capturedTricks stores each trick under its winner with the cards in
    // the order they hit the table. The leader chain (bidder leads trick 1,
    // thereafter the previous winner leads) attributes every card to a seat.
    const completedTricks = [];
    for (const winnerName in engine.capturedTricks) {
        for (const trick of engine.capturedTricks[winnerName] || []) {
            completedTricks.push({
                trickNumber: trick.trickNumber,
                cards: [...trick.cards],
                winnerName: trick.winnerName || winnerName,
            });
        }
    }
    completedTricks.sort((a, b) => a.trickNumber - b.trickNumber);

    const playedBy = {};
    activeNames.forEach(name => { playedBy[name] = []; });
    const voids = {};
    activeNames.forEach(name => { voids[name] = new Set(); });
    const playedSet = new Set();

    let brokenDuringReplay = false;
    let leaderName = bidderName;
    const noteVoid = (name, suit) => { if (voids[name]) voids[name].add(suit); };

    const replayPlay = (playerName, card, positionInTrick, leadSuit) => {
        playedSet.add(card);
        if (playedBy[playerName]) playedBy[playerName].push(card);
        const suit = getSuit(card);
        if (positionInTrick === 0) {
            // Leading trump before trump is broken is only legal with an
            // all-trump hand, so it reveals voids in every other suit.
            if (suit === trumpSuit && !brokenDuringReplay) {
                ALL_SUITS.filter(s => s !== trumpSuit)
                    .forEach(s => noteVoid(playerName, s));
            }
        } else if (suit !== leadSuit) {
            noteVoid(playerName, leadSuit);
            // Void in the lead suit MUST trump when holding trump, so a
            // non-trump discard proves a trump void as well.
            if (suit !== trumpSuit) noteVoid(playerName, trumpSuit);
        }
        if (suit === trumpSuit) brokenDuringReplay = true;
    };

    for (const trick of completedTricks) {
        const leaderIdx = activeNames.indexOf(leaderName);
        if (leaderIdx === -1) return null;
        const leadSuit = getSuit(trick.cards[0]);
        trick.cards.forEach((card, i) => {
            replayPlay(activeNames[(leaderIdx + i) % n], card, i, leadSuit);
        });
        leaderName = trick.winnerName;
    }

    // --- Current trick -------------------------------------------------
    // During TrickCompleteLinger the just-finished trick is still in
    // currentTrickCards AND already in capturedTricks; dedupe by card so it
    // is never counted twice and never treated as a live partial trick.
    const partialTrick = (engine.currentTrickCards || [])
        .filter(play => !playedSet.has(play.card))
        .map(play => ({ playerName: play.playerName, card: play.card }));
    const partialLeadSuit = partialTrick.length > 0 ? getSuit(partialTrick[0].card) : null;
    partialTrick.forEach((play, i) => replayPlay(play.playerName, play.card, i, partialLeadSuit));

    const trickLeaderName = partialTrick.length > 0
        ? partialTrick[0].playerName
        : (engine.players[engine.trickLeaderId]?.playerName || leaderName);
    if (!activeNames.includes(trickLeaderName)) return null;

    // --- Widow knowledge (bid-type specific) ---------------------------
    let frog = null;
    if (bidType === 'Frog') {
        const revealedWidow = [...(engine.revealedWidowForFrog || [])];
        frog = {
            revealedWidow,
            // Only the bidder knows the discards; everyone knows the three
            // revealed widow cards ended up in the bidder's hand-or-discards.
            myDiscards: botName === bidderName
                ? [...(engine.widowDiscardsForFrogBidder || [])]
                : null,
        };
    }

    const scores = {};
    for (const name of activeNames) {
        if (Number.isFinite(engine.scores?.[name])) scores[name] = engine.scores[name];
    }

    return {
        botName,
        botIsBidder: botName === bidderName,
        playerMode: engine.playerMode,
        activeNames,
        n,
        bidderName,
        bidType,
        trumpSuit,
        trumpBroken: Boolean(engine.trumpBroken),
        myHand,
        playedBy,
        playedSet,
        voids,
        bidderCardPoints: engine.bidderCardPoints || 0,
        defenderCardPoints: engine.defenderCardPoints || 0,
        tricksPlayed: engine.tricksPlayedCount || 0,
        partialTrick,
        partialLeadSuit,
        trickLeaderName,
        frog,
        scores,
    };
}

module.exports = { buildPublicView, ALL_SUITS, RANKS_ORDER };
