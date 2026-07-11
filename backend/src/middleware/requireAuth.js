const CURRENT_USER_QUERY = `
    SELECT id, username, is_admin
    FROM users
    WHERE id = $1
`;

async function loadCurrentUserByTokenId(pool, tokenUser) {
    if (!pool || typeof pool.query !== 'function') {
        throw new TypeError('A database pool with a query function is required.');
    }

    const tokenUserId = Number(tokenUser?.id);
    if (!Number.isSafeInteger(tokenUserId) || tokenUserId <= 0) return null;

    const { rows } = await pool.query(CURRENT_USER_QUERY, [tokenUserId]);
    const currentUser = rows?.[0];
    if (!currentUser) return null;

    return {
        id: currentUser.id,
        username: currentUser.username,
        is_admin: currentUser.is_admin === true,
    };
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
