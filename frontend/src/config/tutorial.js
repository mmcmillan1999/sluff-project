export const TUTORIAL_VERSION = 1;
export const TUTORIAL_THEME_ID = 'miss-pauls-academy';
export const TUTORIAL_BUY_IN_LABEL = '0.10';

export const tutorialLessonStorageKey = (userId, version = TUTORIAL_VERSION) => (
    `sluff:tutorial:${version}:lessons:${String(userId ?? 'anonymous')}`
);

export const TUTORIAL_RECAP_HINT = Object.freeze({
    eyebrow: 'Round recap',
    title: 'See where every point came from',
    body: 'Card points, distance from 60, and the bid multiplier explain how each score moves. Continue when you are ready to count it.',
});

export const TUTORIAL_FORFEIT_RECAP_HINT = Object.freeze({
    eyebrow: 'Game settlement',
    title: 'A forfeit ends the game',
    body: 'The recap records why the game ended and how the final settlement affected each player.',
});
