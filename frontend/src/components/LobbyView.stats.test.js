import { deriveLobbyPlayerStats } from './LobbyView';

describe('deriveLobbyPlayerStats', () => {
    test('uses the hydrated profile contract for games, wins, and coin balance', () => {
        expect(deriveLobbyPlayerStats({
            wins: 3,
            losses: 2,
            washes: 1,
            games_played: 6,
            tokens: '8.75',
        })).toEqual({
            gamesWon: 3,
            gamesPlayed: 6,
            coinBalance: 8.75,
            winRate: '50.0',
        });
    });

    test('derives games played from outcome totals and keeps legacy wins compatible', () => {
        expect(deriveLobbyPlayerStats({
            games_won: 2,
            losses: 1,
            washes: 1,
            tokens: 'not-a-number',
        })).toEqual({
            gamesWon: 2,
            gamesPlayed: 4,
            coinBalance: 0,
            winRate: '50.0',
        });
    });
});
