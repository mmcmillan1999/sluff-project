import { sanitizeFeedbackGameContext } from './feedbackGameContext';

describe('sanitizeFeedbackGameContext', () => {
    test('keeps useful diagnostics while removing every card-bearing and personalized field', () => {
        const context = {
            tableId: 'table-7',
            tableName: 'Seven of Clubs',
            theme: 'classic',
            state: 'Playing Phase',
            serverTime: 123456,
            serverVersion: '13.0.0',
            playerMode: 3,
            gameStarted: true,
            dealer: 2,
            widowCount: 3,
            tricksPlayedCount: 4,
            scores: { Alice: 118, Bob: 121, Cara: 121 },
            players: {
                1: {
                    userId: 1,
                    playerName: 'Alice',
                    isSpectator: false,
                    disconnected: false,
                    isBot: false,
                    socketId: 'private-socket',
                    tokens: '999.00',
                    hand: ['PRIVATE-PLAYER-CARD'],
                },
            },
            seatingOrder: ['Alice', 'Bob', 'Cara'],
            playerOrderActive: ['Alice', 'Bob', 'Cara'],
            hands: { Alice: ['PRIVATE-HAND-CARD'] },
            widow: ['PRIVATE-WIDOW-CARD'],
            originalDealtWidow: ['PRIVATE-ORIGINAL-WIDOW-CARD'],
            widowDiscardsForFrogBidder: ['PRIVATE-DISCARD-CARD'],
            revealedWidowForFrog: ['PUBLIC-BUT-UNNEEDED-CARD'],
            currentTrickCards: [{ playerName: 'Alice', card: 'PUBLIC-TRICK-CARD' }],
            capturedTricks: { Alice: [[{ card: 'PUBLIC-CAPTURED-CARD' }]] },
            lastCompletedTrick: { cards: [{ card: 'PUBLIC-LAST-CARD' }] },
            currentHighestBidDetails: { userId: 1, playerName: 'Alice', bid: 'Solo', hidden: 'drop-me' },
            bidWinnerInfo: { userId: 1, playerName: 'Alice', bid: 'Solo' },
            insurance: {
                isActive: true,
                bidMultiplier: 2,
                bidderPlayerName: 'Alice',
                bidderRequirement: 20,
                defenderOffers: { Bob: 10, Cara: 10 },
                dealExecuted: true,
                executedDetails: {
                    agreement: {
                        bidderPlayerName: 'Alice',
                        bidderRequirement: 20,
                        bidderSettlement: 20,
                        defenderOffers: { Bob: 10, Cara: 10 },
                        secretCards: ['PRIVATE-INSURANCE-CARD'],
                    },
                },
            },
            drawRequest: {
                isActive: true,
                initiator: 'Bob',
                votes: { Alice: 'no', Bob: 'split', Cara: null },
                timer: { secret: 'drop-me' },
            },
            settlement: { status: 'pending', kind: 'normal', attempts: 1, internal: 'drop-me' },
            roundSummary: {
                message: 'Round complete',
                finalScores: { Alice: 118, Bob: 121, Cara: 121 },
                pointChanges: { Alice: -2, Bob: 1, Cara: 1 },
                bidType: 'Solo',
                allTricks: { Alice: ['PRIVATE-SUMMARY-CARD'] },
                widowForReveal: ['PRIVATE-SUMMARY-WIDOW'],
                lastCompletedTrick: { cards: ['PRIVATE-SUMMARY-LAST-CARD'] },
            },
            futurePrivateState: { cards: ['PRIVATE-FUTURE-CARD'] },
        };

        const sanitized = sanitizeFeedbackGameContext(context);

        expect(sanitized).toMatchObject({
            tableId: 'table-7',
            tableName: 'Seven of Clubs',
            state: 'Playing Phase',
            playerMode: 3,
            widowCount: 3,
            tricksPlayedCount: 4,
            scores: { Alice: 118, Bob: 121, Cara: 121 },
            players: {
                1: {
                    userId: 1,
                    playerName: 'Alice',
                    isSpectator: false,
                    disconnected: false,
                    isBot: false,
                },
            },
            currentHighestBidDetails: { userId: 1, playerName: 'Alice', bid: 'Solo' },
            insurance: {
                bidderRequirement: 20,
                defenderOffers: { Bob: 10, Cara: 10 },
            },
            drawRequest: {
                isActive: true,
                initiator: 'Bob',
                votes: { Alice: 'no', Bob: 'split', Cara: null },
            },
            settlement: { status: 'pending', kind: 'normal', attempts: 1 },
            roundSummary: {
                message: 'Round complete',
                finalScores: { Alice: 118, Bob: 121, Cara: 121 },
                pointChanges: { Alice: -2, Bob: 1, Cara: 1 },
                bidType: 'Solo',
            },
        });

        expect(sanitized).not.toHaveProperty('hands');
        expect(sanitized).not.toHaveProperty('widow');
        expect(sanitized.players[1]).not.toHaveProperty('socketId');
        expect(sanitized.players[1]).not.toHaveProperty('tokens');
        expect(sanitized.roundSummary).not.toHaveProperty('allTricks');
        expect(sanitized).not.toHaveProperty('futurePrivateState');
        expect(JSON.stringify(sanitized)).not.toContain('PRIVATE-');
        expect(context.hands.Alice).toEqual(['PRIVATE-HAND-CARD']);
    });

    test('fails closed for absent or non-object context', () => {
        expect(sanitizeFeedbackGameContext(null)).toBeNull();
        expect(sanitizeFeedbackGameContext(['PRIVATE-CARD'])).toBeNull();
        expect(sanitizeFeedbackGameContext('PRIVATE-CARD')).toBeNull();
    });
});
