export const THEME_PRESENTATION = Object.freeze({
    'fort-creek': Object.freeze({
        id: 'fort-creek',
        name: 'Fort Creek',
        eyebrow: 'Oakley ranch nights',
        description: 'Cowhide, leather & campfire cards',
    }),
    'shirecliff-road': Object.freeze({
        id: 'shirecliff-road',
        name: 'Shirecliff',
        eyebrow: "Grandpa George's table",
        description: 'Dark walnut & old-school polish',
    }),
    'dans-deck': Object.freeze({
        id: 'dans-deck',
        name: 'Eaglewood',
        eyebrow: 'Above the Great Salt Lake',
        description: 'Deck games at sunset',
    }),
    'miss-pauls-academy': Object.freeze({
        id: 'miss-pauls-academy',
        name: 'Academy',
        eyebrow: "Miss Paul's classroom",
        description: 'Learn the game on the green table',
    }),
});

export const THEME_IDS = Object.freeze([
    'fort-creek',
    'shirecliff-road',
    'dans-deck',
    'miss-pauls-academy',
]);

export const DEFAULT_THEME_PRESENTATION = Object.freeze({
    id: 'classic',
    name: 'Sluff Table',
    eyebrow: 'Classic table',
    description: 'A familiar place to play',
});

export const isCanonicalThemeId = (themeId) => (
    typeof themeId === 'string'
    && Object.prototype.hasOwnProperty.call(THEME_PRESENTATION, themeId)
);

export const getThemePresentation = (themeId) => (
    isCanonicalThemeId(themeId)
        ? THEME_PRESENTATION[themeId]
        : DEFAULT_THEME_PRESENTATION
);
