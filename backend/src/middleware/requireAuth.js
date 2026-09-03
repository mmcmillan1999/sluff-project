const CURRENT_USER_QUERY = `
    SELECT id, username, is_admin, sessions_valid_after
    FROM users
    WHERE id = $1
      AND COALESCE(is_bot, FALSE) = FALSE
`;

// A token minted before sessions_valid_after (set by a password reset) is
// dead even though its signature and 90-day expiry are fine. Compared at
// whole-second granularity because JWT iat is in seconds: a token issued in
// the same second as the reset is the one the resetting user just got.
function tokenPredatesRevocation(tokenUser, currentUser) {
    const validAfter = currentUser?.sessions_valid_after;
    if (!validAfter) return false;
    const issuedAt = Number(tokenUser?.iat);
    if (!Number.isFinite(issuedAt)) return false;
    const validAfterSeconds = Math.floor(new Date(validAfter).getTime() / 1000);
    return Number.isFinite(validAfterSeconds) && issuedAt < validAfterSeconds;
}

async function loadCurrentUserByTokenId(pool, tokenUser) {
    if (!pool || typeof pool.query !== 'function') {
        throw new TypeError('A database pool with a query function is required.');
    }

    const tokenUserId = Number(tokenUser?.id);
    if (!Number.isSafeInteger(tokenUserId) || tokenUserId <= 0) return null;

    const { rows } = await pool.query(CURRENT_USER_QUERY, [tokenUserId]);
    const currentUser = rows?.[0];
    if (!currentUser) return null;
    if (tokenPredatesRevocation(tokenUser, currentUser)) return null;

    const hydrated = {
        id: currentUser.id,
        username: currentUser.username,
        is_admin: currentUser.is_admin === true,
    };
    // Carried on the socket so the 60 s identity refresh can re-check
    // revocation without the original token.
    if (Number.isFinite(Number(tokenUser?.iat))) hydrated.tokenIssuedAt = Number(tokenUser.iat);
    return hydrated;
}

const requireAuth = (pool, jwt) => {
    if (!jwt || typeof jwt.verify !== 'function') {
        throw new TypeError('A JWT implementation with a verify function is required.');
    }
    if (!pool || typeof pool.query !== 'function') {
        throw new TypeError('A database pool with a query function is required.');
    }

    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const bearerMatch = typeof authHeader === 'string'
            ? authHeader.match(/^Bearer\s+(\S+)$/i)
            : null;

        if (!bearerMatch) {
            return res.status(401).json({ message: 'Authentication required.' });
        }

        jwt.verify(bearerMatch[1], process.env.JWT_SECRET, async (error, tokenUser) => {
            if (error) {
                return res.status(403).json({ message: 'Invalid or expired token.' });
            }

            try {
                const currentUser = await loadCurrentUserByTokenId(pool, tokenUser);
                if (!currentUser) {
                    return res.status(401).json({ message: 'Authentication required.' });
                }

                req.user = currentUser;
                return next();
            } catch (databaseError) {
                console.error('Failed to hydrate authenticated user:', databaseError);
                return res.status(500).json({ message: 'Unable to authenticate request.' });
            }
        });
    };
};

module.exports = requireAuth;
module.exports.CURRENT_USER_QUERY = CURRENT_USER_QUERY;
module.exports.loadCurrentUserByTokenId = loadCurrentUserByTokenId;
