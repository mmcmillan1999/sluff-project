export const alphaSeasonOne = Object.freeze({
    status: 'Season in progress',
    eyebrow: 'Alpha Season 1',
    title: 'The first Sluff season is headed for the history books.',
    summary: 'When Alpha Season 1 closes, its final leaderboard will be preserved here instead of changing with the live standings.',
    spotlight: {
        label: 'Season shout-out',
        name: 'McSaddle',
        note: 'For helping write some of the earliest chapters in Sluff history.',
    },
    podium: [
        { place: 1, label: 'Champion', player: null },
        { place: 2, label: 'Second place', player: null },
        { place: 3, label: 'Third place', player: null },
    ],
    archiveNote: 'Final names and records will be added only after the season is officially closed and the standings are safely frozen.',
});

export const bulletinTickerItems = Object.freeze([
    'Alpha Season 1 is headed for the history books',
    'A season shout-out to McSaddle',
    'The final Top 3 will be preserved in the Alpha Season 1 archive',
    'Four-player tables, Quick Play, guided training, and a livelier card table',
    'Token accountability and 20 persistent bot players are in development',
    'Open the Bulletin for the full story',
]);

export const bulletinEntries = Object.freeze([
    {
        id: 'token-accountability',
        dateLabel: 'Current build',
        status: 'In development',
        title: 'Every token accounted for',
        summary: 'The next release makes token movement visible and gives the test bots real, accountable player records.',
        highlights: [
            'A personal Token Ledger shows every buy-in, payout, refund, mercy token, and adjustment.',
            'Historical games with ambiguous recovery data are quarantined instead of guessed at.',
            'A read-only accounting audit can trace suspicious movement without changing balances.',
            'Twenty named bots are being prepared with persistent identities, funded balances, stats, and leaderboard records.',
        ],
    },
    {
        id: 'table-comes-alive',
        dateLabel: 'June-July 2026',
        status: 'Alpha update',
        title: 'The table comes alive',
        summary: 'Sluff now tells more of the game through motion, position, and sound while keeping the table readable on a portrait phone.',
        highlights: [
            'Cards deal clockwise from the deck, one at a time, with curved flight and natural rotation.',
            'Widow, trick, bidder, and team plates position themselves around the actual seats.',
            'Bidding prompts and the VS presentation were tightened to keep player names and the table visible.',
            'Real card faces, branded felt, and persistent sound controls gave the table a stronger identity.',
            'Tricks, widow reveals, bidding, and round moments gained richer motion and sound.',
        ],
    },
    {
        id: 'round-finale',
        dateLabel: 'July 2026',
        status: 'Alpha update',
        title: 'A better finish to every round',
        summary: 'Scoring now has room to breathe, from the round recap through the final celebration.',
        highlights: [
            'Players collect winnings or hand over losses before updated totals are revealed.',
            'The settled recap remains visible long enough for everyone to absorb the result.',
            'Completed games end with a podium, confetti, and a clear token-award presentation.',
        ],
    },
    {
        id: 'find-a-game',
        dateLabel: 'July 2026',
        status: 'Alpha update',
        title: 'More ways to find a game',
        summary: 'Quick Play gets people seated faster while private tables remain easy to share with friends.',
        highlights: [
            'Quick Play searches for human opponents first, with discreet bot backup for quiet moments.',
            'Three-player groups can start immediately or search briefly for a fourth player.',
            'Four-player Sluff is fully playable, with the dealer sitting out each hand.',
            'Private tables can be shared through direct invite links.',
        ],
    },
    {
        id: 'learn-and-return',
        dateLabel: 'July 2026',
        status: 'Alpha update',
        title: 'Easier to learn and easier to return',
        summary: 'New players can learn at the table, and experienced players can revisit the training whenever they want.',
        highlights: [
            'A guided first-game tutorial teaches Sluff inside a real game.',
            'Tutorial training can be reset from the player menu for another run-through.',
            'The How to Play guide now covers bidding, insurance, card order, and scoring.',
            'Reconnect and table-restoration flows are more dependable after an interruption.',
        ],
    },
    {
        id: 'safer-foundation',
        dateLabel: 'July 2026',
        status: 'Behind the scenes',
        title: 'A safer foundation',
        summary: 'A broad hardening pass made accounts, hidden information, settlements, backups, and deployments safer.',
        highlights: [
            'Game actions are authenticated and checked against live server state.',
            'Private cards and hidden table information stay private to the correct player.',
            'Buy-ins and settlements are atomic and protected against accidental duplicate payouts.',
            'Database backups, account cleanup, credential scanning, and crash recovery gained new safeguards.',
        ],
    },
]);
