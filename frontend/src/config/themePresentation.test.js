import { describe, expect, test } from 'vitest';
import {
    DEFAULT_THEME_PRESENTATION,
    THEME_IDS,
    THEME_PRESENTATION,
    getThemePresentation,
    isCanonicalThemeId,
} from './themePresentation';

describe('theme presentation contract', () => {
    test('locks the canonical server-facing theme IDs', () => {
        expect(THEME_IDS).toEqual([
            'fort-creek',
            'shirecliff-road',
            'dans-deck',
            'miss-pauls-academy',
        ]);
        expect(THEME_IDS).toHaveLength(4);
        expect(Object.keys(THEME_PRESENTATION)).toEqual(THEME_IDS);
        THEME_IDS.forEach(themeId => {
            expect(isCanonicalThemeId(themeId)).toBe(true);
            expect(THEME_PRESENTATION[themeId]?.id).toBe(themeId);
        });
    });

    test('presents Eaglewood without changing its internal ID', () => {
        expect(getThemePresentation('dans-deck')).toEqual({
            id: 'dans-deck',
            name: 'Eaglewood',
            eyebrow: 'Above the Great Salt Lake',
            description: 'Deck games at sunset',
        });
    });

    test('provides the intended venue copy for every canonical theme', () => {
        expect(getThemePresentation('fort-creek')).toMatchObject({
            eyebrow: 'Oakley ranch nights',
            description: 'Cowhide, leather & campfire cards',
        });
        expect(getThemePresentation('shirecliff-road')).toMatchObject({
            eyebrow: "Grandpa George's table",
            description: 'Dark walnut & old-school polish',
        });
        expect(getThemePresentation('miss-pauls-academy')).toMatchObject({
            eyebrow: "Miss Paul's classroom",
            description: 'Learn the game on the green table',
        });
    });

    test.each([undefined, null, '', 'eaglewood', '__proto__'])(
        'returns the frozen fallback for unknown ID %s',
        (themeId) => {
            expect(isCanonicalThemeId(themeId)).toBe(false);
            expect(getThemePresentation(themeId)).toBe(DEFAULT_THEME_PRESENTATION);
            expect(getThemePresentation(themeId)).toEqual({
                id: 'classic',
                name: 'Sluff Table',
                eyebrow: 'Classic table',
                description: 'A familiar place to play',
            });
            expect(Object.isFrozen(getThemePresentation(themeId))).toBe(true);
        },
    );
});
