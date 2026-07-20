import { describe, expect, test } from 'vitest';
import { buildScoreTransferPlan } from './scoreTransferPlan';

describe('buildScoreTransferPlan', () => {
    test('moves two equal payments to a single winner in player order', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        })).toEqual({
            balanced: true,
            transfers: [
                { id: 'score-transfer-1', from: 'Bob', to: 'Alice', amount: 6 },
                { id: 'score-transfer-2', from: 'Cara', to: 'Alice', amount: 6 },
            ],
        });
    });

    test('keeps the three-player ScoreAbsorber as the final recipient', () => {
        expect(buildScoreTransferPlan({
            pointChanges: {
                Alice: -60,
                Bob: 20,
                Cara: 20,
                ScoreAbsorber: 20,
            },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        })).toEqual({
            balanced: true,
            transfers: [
                { id: 'score-transfer-1', from: 'Alice', to: 'Bob', amount: 20 },
                { id: 'score-transfer-2', from: 'Alice', to: 'Cara', amount: 20 },
                { id: 'score-transfer-3', from: 'Alice', to: 'ScoreAbsorber', amount: 20 },
            ],
        });
    });

    test('includes a sitting four-player dealer that is outside the active order', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: -60, Bob: 20, Cara: 20, Drew: 20 },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        }).transfers).toEqual([
            { id: 'score-transfer-1', from: 'Alice', to: 'Bob', amount: 20 },
            { id: 'score-transfer-2', from: 'Alice', to: 'Cara', amount: 20 },
            { id: 'score-transfer-3', from: 'Alice', to: 'Drew', amount: 20 },
        ]);
    });

    test('pairs mixed insurance gains with multiple recipients deterministically', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 10, Bob: 20, Cara: -30, Drew: 0 },
            playerOrder: ['Drew', 'Bob', 'Cara', 'Alice'],
        }).transfers).toEqual([
            { id: 'score-transfer-1', from: 'Cara', to: 'Bob', amount: 20 },
            { id: 'score-transfer-2', from: 'Cara', to: 'Alice', amount: 10 },
        ]);
    });

    test('returns a balanced empty plan when every score change is zero', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 0, Bob: -0, Cara: 0 },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        })).toEqual({ transfers: [], balanced: true });
    });

    test('normalizes payments to two decimals and ignores floating-point noise', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 0.1 + 0.2, Bob: -0.1, Cara: -0.2 },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        })).toEqual({
            balanced: true,
            transfers: [
                { id: 'score-transfer-1', from: 'Bob', to: 'Alice', amount: 0.1 },
                { id: 'score-transfer-2', from: 'Cara', to: 'Alice', amount: 0.2 },
            ],
        });

        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 2.005, Bob: -2.005 },
            playerOrder: ['Alice', 'Bob'],
        }).transfers[0].amount).toBe(2.01);

        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 10.075, Bob: -10.075 },
            playerOrder: ['Alice', 'Bob'],
        }).transfers[0].amount).toBe(10.08);
    });

    test.each([
        ['missing changes', undefined, ['Alice']],
        ['array changes', [6, -6], ['Alice', 'Bob']],
        ['numeric string', { Alice: '6', Bob: -6 }, ['Alice', 'Bob']],
        ['not-a-number', { Alice: Number.NaN, Bob: -6 }, ['Alice', 'Bob']],
        ['infinite value', { Alice: Number.POSITIVE_INFINITY, Bob: -6 }, ['Alice', 'Bob']],
        ['empty participant', { '': 6, Bob: -6 }, ['', 'Bob']],
        ['invalid player order', { Alice: 6, Bob: -6 }, 'Alice,Bob'],
    ])('rejects malformed input: %s', (_label, pointChanges, playerOrder) => {
        expect(buildScoreTransferPlan({ pointChanges, playerOrder })).toEqual({
            transfers: [],
            balanced: false,
        });
    });

    test('does not create a partial animation for an unbalanced score payload', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 12, Bob: -6, Cara: -5 },
            playerOrder: ['Alice', 'Bob', 'Cara'],
        })).toEqual({ transfers: [], balanced: false });
    });

    test('uses remaining object-key order after de-duplicating playerOrder', () => {
        expect(buildScoreTransferPlan({
            pointChanges: { Alice: 10, Bob: -4, Cara: -6 },
            playerOrder: ['Bob', 'Bob', 'Missing'],
        }).transfers).toEqual([
            { id: 'score-transfer-1', from: 'Bob', to: 'Alice', amount: 4 },
            { id: 'score-transfer-2', from: 'Cara', to: 'Alice', amount: 6 },
        ]);
    });
});
