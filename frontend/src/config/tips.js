// frontend/src/config/tips.js
// The quick-tips catalogue behind the in-game "i" beacon (top-left). Add a
// new entry here whenever a feature ships that players should hear about;
// anyone who hasn't dismissed it sees the beacon count tick up. Dismissals
// are per-user server-side (user_tips_seen via /api/tips) with a
// localStorage fallback, so never reuse an id — date-stamp them instead.
//
//   id      kebab-case slug + YYYY-MM (must satisfy the backend TIP_ID_PATTERN)
//   title   headline shown on the tip card
//   body    one or two sentences of copy
//   widget  optional interactive block rendered under the body:
//             'play-style' — the Flick/Fast card play toggle

export const TIPS = [
    {
        id: 'fast-play-style-2026-07',
        title: 'New: choose how you play cards',
        body: 'Flick keeps the classic drag-and-throw. Fast lets you click a card to raise it, then click again to play it instantly. Pick whichever feels right — you can change it anytime from the menu.',
        widget: 'play-style',
    },
];

export const TIP_IDS = TIPS.map(tip => tip.id);
