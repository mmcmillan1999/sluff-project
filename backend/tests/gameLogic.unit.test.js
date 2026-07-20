// backend/tests/gameLogic.unit.test.js

const assert = require('assert');
// --- PATH CORRECTION ---
const gameLogic = require('../src/core/logic');

function runGameLogicTests() {
    console.log('Running gameLogic.js tests...');

    let testCounter = 1;
    const pass = (testName) => console.log(`  âœ” Test ${testCounter++}: ${testName}`);

    // --- Trick Winner Tests ---
    const playsTrump = [ { userId: 1, playerName: 'Alice', card: '10H' }, { userId: 2, playerName: 'Bob', card: 'AS' }, { userId: 3, playerName: 'Carol', card: 'KH' }];
    let result = gameLogic.determineTrickWinner(playsTrump, 'H', 'S');
    assert.strictEqual(result.playerName, 'Bob');
    pass('Trump should win trick.');

    const followsSuit = [ { userId: 1, playerName: 'Alice', card: '10H' }, { userId: 2, playerName: 'Bob', card: 'AH' }, { userId: 3, playerName: 'Carol', card: 'KH' }];
    result = gameLogic.determineTrickWinner(followsSuit, 'H', 'S');
    assert.strictEqual(result.playerName, 'Bob');
    pass('Highest of lead suit should win.');

    // --- Payout Tests ---
    const forfeitTable = {
        theme: 'fort-creek',
        players: {
            1: { userId: 1, playerName: 'Alice', isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isSpectator: false },
            3: { userId: 3, playerName: 'Carol', isSpectator: false },
        },
        scores: { 'Alice': 120, 'Bob': 80, 'Carol': 100 }
    };
    let payout = gameLogic.calculateForfeitPayout(forfeitTable, 'Bob');
    assert.strictEqual(payout['Alice'].totalGain.toFixed(3), '1.545');
    pass('Forfeit payout for Alice is correct.');
    assert.strictEqual(payout['Carol'].totalGain.toFixed(3), '1.455');
    pass('Forfeit payout for Carol is correct.');

    const drawTable3Player = {
        theme: 'fort-creek', // Buy-in is 1 token
        players: {
            1: { userId: 1, playerName: 'Alice', isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isSpectator: false },
            3: { userId: 3, playerName: 'Carol', isSpectator: false },
        },
        scores: { 'Alice': 90, 'Bob': 80, 'Carol': 60 }
    };
    let drawResult = gameLogic.calculateDrawSplitPayout(drawTable3Player);
    assert.strictEqual(drawResult.wash, false, '3-player draw with different scores should be a split.');
    pass('Draw Split: Correctly identifies a 3-player split.');
    assert.ok(Math.abs(drawResult.payouts['Carol'].totalReturn - 0.50) < 0.001, 'Lowest player (Carol) should get 50% of buy-in back.');
    pass('Draw Split: Lowest player payout is correct.');
    assert.ok(Math.abs(drawResult.payouts['Alice'].totalReturn - 1.2647) < 0.001, 'Highest player (Alice) share is incorrect.');
    pass('Draw Split: Highest player payout is correct.');
    assert.ok(Math.abs(drawResult.payouts['Bob'].totalReturn - 1.2352) < 0.001, 'Middle player (Bob) share is incorrect.');
    pass('Draw Split: Middle player payout is correct.');

    const drawTable4Player = { ...drawTable3Player, players: {...drawTable3Player.players, 4: {userId: 4, playerName: 'Dave'}}};
    let washResult = gameLogic.calculateDrawSplitPayout(drawTable4Player);
    assert.strictEqual(washResult.wash, true, 'A 4-player game draw should always be a wash.');
    pass('Draw Wash: Correctly identifies a 4-player game as a wash.');
    
    // --- Scoring Tests ---
    const mockScoringTable = {
        playerOrderActive: [1, 2, 3], 
        playerMode: 3,
        players: { 1: { playerName: 'Alice' }, 2: { playerName: 'Bob' }, 3: { playerName: 'Carol' } },
        insurance: { dealExecuted: false, defenderOffers: {} },
        capturedTricks: {},
        originalDealtWidow: []
    };
    
    let succeedResult = gameLogic.calculateRoundScoreDetails({ ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, bidderTotalCardPoints: 70 });
    assert.strictEqual(succeedResult.pointChanges['Alice'], 40);
    pass('Bidder success points correct.');
    assert.strictEqual(succeedResult.pointChanges['Bob'], -20);
    pass('Defender loss points correct.');

    let failResult3Player = gameLogic.calculateRoundScoreDetails({ ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, bidderTotalCardPoints: 50 });
    assert.strictEqual(failResult3Player.pointChanges['Alice'], -60);
    pass('3-player bidder fail points correct.');
    assert.strictEqual(failResult3Player.pointChanges['Bob'], 20);
    pass('3-player defender win points correct.');
    assert.strictEqual(failResult3Player.pointChanges['ScoreAbsorber'], 20);
    pass('3-player ScoreAbsorber points correct.');
    
    // --- THIS IS THE OLD WIDOW LOGIC TEST ---
    const widowPts = 15;
    const mockWidow = ['AC', 'KC']; // Worth 11 + 4 = 15 points
    const baseTrickPoints = 50;

    const hsWinTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Heart Solo' }, originalDealtWidow: mockWidow, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let hsWinResult = gameLogic.calculateRoundScoreDetails(hsWinTable);
    assert.strictEqual(hsWinResult.finalBidderPoints, 65, 'HS Win: Bidder points incorrect.');
    pass('Heart Solo: Widow points are correctly assigned.');
    
    const soloTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, originalDealtWidow: mockWidow, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let soloResult = gameLogic.calculateRoundScoreDetails(soloTable);
    assert.strictEqual(soloResult.finalBidderPoints, 65, 'Solo: Bidder points incorrect.');
    pass('Solo Bid: Widow points go to bidder.');

    // --- THIS IS THE NEW TEST CASE ---
    const mockDiscards = ['AD', 'KD']; // Worth 11 + 4 = 15 points
    const frogTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Frog' }, widowDiscardsForFrogBidder: mockDiscards, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let frogResult = gameLogic.calculateRoundScoreDetails(frogTable);
    assert.strictEqual(frogResult.finalBidderPoints, 65, 'Frog: Bidder points incorrect.');
    pass('Frog Bid: Bidder gets points from their discarded cards.');
    
    // --- Card point-change helper (analytics counterfactual) ---
    // It must equal the applied no-deal pointChanges (one source of truth).
    const cardArgs = {
        activePlayerNames: ['Alice', 'Bob', 'Carol'],
        bidWinnerName: 'Alice',
        bidMultiplier: 2,
        playerMode: 3,
        sittingOutDealerName: null,
    };
    const failCards = gameLogic.calculateCardPointChanges({ ...cardArgs, bidderTotalCardPoints: 50 });
    assert.strictEqual(failCards['Alice'], -60, 'Card helper: failed-bid bidder incorrect.');
    assert.strictEqual(failCards['Bob'], 20, 'Card helper: failed-bid defender incorrect.');
    assert.strictEqual(failCards['ScoreAbsorber'], 20, 'Card helper: failed-bid widow share incorrect.');
    const appliedFail = gameLogic.calculateRoundScoreDetails({ ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, bidderTotalCardPoints: 50 });
    assert.deepStrictEqual(failCards, appliedFail.pointChanges, 'Card helper must match applied no-deal pointChanges.');
    assert.deepStrictEqual(appliedFail.cardPointChanges, appliedFail.pointChanges, 'No-deal: cardPointChanges must equal applied pointChanges.');
    pass('Card point-change helper equals the applied no-deal scoring.');

    // Under a deal, cardPointChanges is the counterfactual, not the applied deal.
    const dealCounterfactual = gameLogic.calculateRoundScoreDetails({
        ...mockScoringTable,
        insurance: {
            dealExecuted: true,
            defenderOffers: { Bob: 8, Carol: 12 },
            executedDetails: { agreement: { bidderPlayerName: 'Alice', bidderRequirement: 20, bidderSettlement: 20, defenderOffers: { Bob: 8, Carol: 12 } } },
        },
        bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' },
        bidderTotalCardPoints: 50,
    });
    assert.strictEqual(dealCounterfactual.pointChanges['Alice'], 20, 'Deal applied: bidder settlement incorrect.');
    assert.strictEqual(dealCounterfactual.cardPointChanges['Alice'], -60, 'Deal counterfactual: cards would have cost the bidder 60.');
    assert.strictEqual(dealCounterfactual.cardPointChanges['Bob'], 20, 'Deal counterfactual: cards would have paid the defender 20.');
    assert.strictEqual(dealCounterfactual.insuranceHindsight['Alice'].hindsightValue, 80, 'Deal hindsight: bidder saved the settlement plus the full failed-bid cost.');
    assert.strictEqual(dealCounterfactual.insuranceHindsight['Bob'].hindsightValue, -28, 'Deal hindsight: first defender compares the deal cost with the card win.');
    assert.strictEqual(dealCounterfactual.insuranceHindsight['Carol'].hindsightValue, -32, 'Deal hindsight: second defender compares the deal cost with the card win.');
    for (const playerName of ['Alice', 'Bob', 'Carol']) {
        assert.strictEqual(
            dealCounterfactual.insuranceHindsight[playerName].hindsightValue,
            dealCounterfactual.pointChanges[playerName] - dealCounterfactual.cardPointChanges[playerName],
            `Deal hindsight for ${playerName} must equal applied deal minus card counterfactual.`
        );
    }
    const fourPlayerDealCounterfactual = gameLogic.calculateRoundScoreDetails({
        ...mockScoringTable,
        playerMode: 4,
        players: {
            ...mockScoringTable.players,
            4: { playerName: 'Dave' },
        },
        dealer: 4,
        insurance: {
            dealExecuted: true,
            defenderOffers: { Bob: 8, Carol: 12 },
            executedDetails: { agreement: { bidderPlayerName: 'Alice', bidderRequirement: 20, bidderSettlement: 20, defenderOffers: { Bob: 8, Carol: 12 } } },
        },
        bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' },
        bidderTotalCardPoints: 50,
    });
    assert.strictEqual(fourPlayerDealCounterfactual.cardPointChanges['Dave'], 20, '4-player counterfactual: the sitting dealer receives the failed-bid share.');
    assert.strictEqual(fourPlayerDealCounterfactual.insuranceHindsight['Alice'].hindsightValue, 80, '4-player deal hindsight includes the sitting dealer share in bidder savings.');
    assert.strictEqual(fourPlayerDealCounterfactual.insuranceHindsight['Dave'], undefined, 'The sitting dealer did not negotiate the deal and is not graded.');
    pass('Under a deal, cardPointChanges reports the card counterfactual.');

    console.log('\n  âœ” All gameLogic.js tests passed!');
}

if (require.main === module) {
    runGameLogicTests();
}

module.exports = runGameLogicTests;
