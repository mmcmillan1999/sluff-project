// backend/scripts/deploy-safety-check.js
//
// Answers one question before you push: is a human mid-game right now?
//
//   npm run deploy:check          # exits 1 if a human would be kicked
//   npm run deploy:check -- --json
//
// A Render deploy restarts the server. Since Aug 2026 the SIGTERM handler
// snapshots live human games and the new instance restores them, but resume is
// best-effort (see src/serialization/gameResume.js); anything it cannot restore
// falls to abandonedGameRecovery, which refunds the buy-ins. Nobody loses
// tokens — but a lost game is what actually annoys the people playing it.
//
// Bot-only games are deliberately NOT a blocker. The exhibition table restarts
// itself and nobody is watching; waiting for it would mean never deploying.

require('dotenv').config();
const { Pool } = require('pg');

// A live game heartbeats. Past this, the row is a leftover the recovery job has
// not swept yet, and interrupting it costs nothing.
const LIVE_WINDOW_MINUTES = 10;

const LIVE_GAMES = `
    SELECT g.game_id,
           g.table_id,
           g.theme,
           g.player_count,
           g.start_time,
           COALESCE(g.last_activity_at, g.start_time) AS last_activity_at,
           EXTRACT(EPOCH FROM (NOW() - COALESCE(g.last_activity_at, g.start_time)))::int AS idle_seconds,
           COUNT(DISTINCT t.user_id) FILTER (WHERE NOT COALESCE(u.is_bot, FALSE))::int AS humans,
           COUNT(DISTINCT t.user_id) FILTER (WHERE COALESCE(u.is_bot, FALSE))::int AS bots,
           ARRAY_AGG(DISTINCT u.username) FILTER (WHERE NOT COALESCE(u.is_bot, FALSE)) AS human_names
    FROM game_history g
    JOIN transactions t ON t.game_id = g.game_id
    JOIN users u ON u.id = t.user_id
    WHERE g.outcome = 'In Progress'
      AND COALESCE(g.last_activity_at, g.start_time) > NOW() - ($1 || ' minutes')::interval
    GROUP BY g.game_id, g.table_id, g.theme, g.player_count, g.start_time, g.last_activity_at
    ORDER BY last_activity_at DESC
`;

// Someone signed in and poking around is not mid-game, but they are about to be.
const RECENT_HUMAN_ACTIVITY = `
    SELECT COUNT(DISTINCT user_id)::int AS n
    FROM lobby_chat_messages
    WHERE user_id IS NOT NULL
      AND created_at > NOW() - INTERVAL '15 minutes'
`;

async function main() {
    const asJson = process.argv.includes('--json');
    if (!process.env.POSTGRES_CONNECT_STRING) {
        console.error('POSTGRES_CONNECT_STRING is not set.');
        process.exit(2);
    }

    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
    });

    try {
        const { rows } = await pool.query(LIVE_GAMES, [String(LIVE_WINDOW_MINUTES)]);
        const humanGames = rows.filter(row => row.humans > 0);
        const botGames = rows.filter(row => row.humans === 0);
        const chatter = (await pool.query(RECENT_HUMAN_ACTIVITY)).rows[0].n;

        if (asJson) {
            console.log(JSON.stringify({
                safe: humanGames.length === 0,
                humanGames: humanGames.length,
                botOnlyGames: botGames.length,
                recentlyActiveHumans: chatter,
                games: humanGames,
            }, null, 2));
        } else {
            console.log(`\nLive games (activity in the last ${LIVE_WINDOW_MINUTES} min)`);
            console.log(`  with humans : ${humanGames.length}`);
            console.log(`  bots only   : ${botGames.length}   (safe to interrupt — the exhibition restarts itself)`);
            console.log(`  humans in lobby chat, last 15 min: ${chatter}`);

            for (const game of humanGames) {
                const names = (game.human_names || []).join(', ');
                console.log(`\n  ! game #${game.game_id} on ${game.table_id} (${game.theme})`);
                console.log(`      ${game.humans} human(s): ${names}`);
                console.log(`      last activity ${game.idle_seconds}s ago`);
            }

            console.log('');
            if (humanGames.length > 0) {
                console.log('DO NOT DEPLOY. A deploy restarts the backend; the SIGTERM snapshot tries to');
                console.log('resume these games on the new instance, but resume is best-effort. Anything');
                console.log('it cannot restore is refunded later — and the players notice either way.');
            } else if (chatter > 0) {
                console.log('No live human games, but someone was in the lobby recently.');
                console.log('Safe to deploy — just be quick about it.');
            } else {
                console.log('Clear. No humans mid-game.');
            }
            console.log('');
        }

        process.exit(humanGames.length > 0 ? 1 : 0);
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error('Deploy safety check failed:', error.message);
    // Failing open would defeat the point: if we cannot tell, assume someone is playing.
    process.exit(2);
});
