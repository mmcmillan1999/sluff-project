import { formatTokens, tokensLabel } from './tournamentFormat';

describe('token amounts on the tournament screens', () => {
    test('whole and fractional amounts read cleanly', () => {
        expect(formatTokens(25)).toBe('25');
        expect(formatTokens(2.5)).toBe('2.5');
        expect(formatTokens(0.25)).toBe('0.25');
        expect(formatTokens(1.001)).toBe('1');
        expect(formatTokens('nope')).toBe('0');
    });

    test('one token is singular, everything else plural', () => {
        expect(tokensLabel(1)).toBe('1 token');
        expect(tokensLabel(25)).toBe('25 tokens');
        expect(tokensLabel(0.5)).toBe('0.5 tokens');
        expect(tokensLabel(0)).toBe('0 tokens');
    });
});
