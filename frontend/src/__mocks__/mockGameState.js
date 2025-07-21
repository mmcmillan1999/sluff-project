// frontend/src/__mocks__/mockGameState.js

export const getMockGameState = (overrides = {}) => {
    const baseState = {
        tableId: 'table-1',
        tableName: 'Test Table',
        state: 'Waiting for Players',
        players: {
            '101': { userId: 101, playerName: 'You', isSpectator: false, disconnected: false, isBot: false },
            '-1': { userId: -1, playerName: 'Bot A', isSpectator: false, disconnected: false, isBot: true },
            '-2': { userId: -2, playerName: 'Bot B', isSpectator: false, disconnected: false, isBot: true },
        },
        playerOrderActive: ['You', 'Bot A', 'Bot B'],
        dealer: -2,
        hands: {
            'You': ['AC', 'KC', 'QC', 'JC', '10C', '9C', '8C', '7C', '6C', 'AD', 'KD'],
            'Bot A': ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', '7S', '6S', 'AH', 'KH'],
            'Bot B': ['QH', 'JH', '10H', '9H', '8H', '7H', '6H', 'QD', 'JD', '10D', '9D'],
        },
        widow: ['6D', '7D', '8D'],
        originalDealtWidow: ['6D', '7D', '8D'],
        scores: { 'You': 120, 'Bot A': 120, 'Bot B': 120 },
        currentHighestBidDetails: null,
        bidWinnerInfo: null,
        gameStarted: true,
        trumpSuit: null,
        currentTrickCards: [],
        tricksPlayedCount: 0,
        leadSuitCurrentTrick: null,
        trumpBroken: false,
        capturedTricks: {},
        roundSummary: null,
        lastCompletedTrick: null,
        playersWhoPassedThisRound: [],
        playerMode: 3,
    };
    
    return { ...baseState, ...overrides };
};