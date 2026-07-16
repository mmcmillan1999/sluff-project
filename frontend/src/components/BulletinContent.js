export const alphaSeasonTwo = Object.freeze({
    eyebrow: 'Alpha Season 2',
    title: 'Season 2 is live. The slate is clean.',
    summary: 'Season 1 is sealed in the record book, every wallet starts from even footing, '
        + 'and the new standings are being written one game at a time.',
    spotlight: {
        label: 'Season 1 Champion',
        name: 'McSaddle',
        note: 'The first name in the Sluff record book. The title is up for defense all season.',
    },
    standings: {
        status: 'Live standings',
        podium: [
            { place: 1, label: 'Leading' },
            { place: 2, label: 'Second' },
            { place: 3, label: 'Third' },
        ],
        openSeatName: 'Up for grabs',
        note: 'Standings move with every ranked game. The full board lives on the Leaderboard.',
        emptyNote: 'The podium is wide open. Win a ranked game and put your name here first.',
    },
});

export const bulletinTickerItems = Object.freeze([
    'Alpha Season 2 is live — fresh stats and an open leaderboard',
    'Season 1 Champion: McSaddle',
    'Every ranked game moves the Season 2 standings',
    'Season 1 is preserved forever in Season Recaps',
    'Open the Bulletin for the season kickoff',
]);

export const bulletinEntries = Object.freeze([
    {
        id: 'season-2-kickoff',
        dateLabel: 'July 2026',
        status: 'Season news',
        title: 'Alpha Season 2 kicks off',
        summary: 'The stats are cleared, the wallets are reset, and everyone starts Season 2 on even footing.',
        highlights: [
            'Season 1’s podium and complete final scoreboard are frozen in Season Recaps.',
            'Every wallet was reset to the season’s starting balance before the first deal.',
            'Season standings now rank by season performance, not lifetime totals.',
            'The champion’s title is on the line: McSaddle starts Season 2 at even footing like everyone else.',
        ],
    },
    {
        id: 'token-accountability',
        dateLabel: 'Current build',
        status: 'In development',
        title: 'Every token accounted for',
        summary: 'The next release makes token movement visible and gives every active seat a real, accountable player record.',
        highlights: [
            'A personal Token Ledger shows every buy-in, payout, refund, mercy token, and adjustment.',
            'Historical games with ambiguous recovery data are quarantined instead of guessed at.',
            'A read-only accounting audit can trace suspicious movement without changing balances.',
            'Every named player keeps a persistent identity, funded balance, stats, and leaderboard record.',
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
            'Quick Play searches for opponents and quietly keeps games moving during slower moments.',
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
