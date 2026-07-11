'use strict';

const CURRENT_TUTORIAL_VERSION = 1;
const TUTORIAL_ACTIONS = new Set(['start', 'complete', 'skip', 'reset']);

function nonNegativeInteger(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.trunc(number));
}

function playerProgressFields(row = {}) {
    const wins = nonNegativeInteger(row.wins);
    const losses = nonNegativeInteger(row.losses);
    const washes = nonNegativeInteger(row.washes);

    return {
        wins,
        losses,
        washes,
        games_played: wins + losses + washes,
        tutorial_version: nonNegativeInteger(row.tutorial_version),
        tutorial_active_version: nonNegativeInteger(row.tutorial_active_version),
    };
}

async function applyTutorialAction(pool, userId, action) {
    const normalizedUserId = Number(userId);
    if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
        throw new TypeError('Tutorial progress requires a positive authenticated user id.');
    }
    if (!TUTORIAL_ACTIONS.has(action)) {
        throw new TypeError(`Unsupported tutorial action: ${action}`);
    }

    let query;
    let params;
    if (action === 'start') {
        query = `UPDATE users
                 SET tutorial_active_version = $2
                 WHERE id = $1
                 RETURNING tutorial_version, tutorial_active_version`;
        params = [normalizedUserId, CURRENT_TUTORIAL_VERSION];
    } else if (action === 'reset') {
        query = `UPDATE users
                 SET tutorial_version = 0,
                     tutorial_active_version = 0
                 WHERE id = $1
                 RETURNING tutorial_version, tutorial_active_version`;
        params = [normalizedUserId];
    } else {
        query = `UPDATE users
                 SET tutorial_version = GREATEST(tutorial_version, $2),
                     tutorial_active_version = 0
                 WHERE id = $1
                 RETURNING tutorial_version, tutorial_active_version`;
        params = [normalizedUserId, CURRENT_TUTORIAL_VERSION];
    }

    const result = await pool.query(query, params);
    if (!result.rows?.length) return null;

    const progress = playerProgressFields(result.rows[0]);
    return {
        tutorial_version: progress.tutorial_version,
        tutorial_active_version: progress.tutorial_active_version,
    };
}

module.exports = {
    CURRENT_TUTORIAL_VERSION,
    applyTutorialAction,
    nonNegativeInteger,
    playerProgressFields,
};
