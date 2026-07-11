const requireAuth = (jwt) => {
    if (!jwt || typeof jwt.verify !== 'function') {
        throw new TypeError('A JWT implementation with a verify function is required.');
    }

    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        const bearerMatch = typeof authHeader === 'string'
            ? authHeader.match(/^Bearer\s+(\S+)$/i)
            : null;

        if (!bearerMatch) {
            return res.status(401).json({ message: 'Authentication required.' });
        }

        jwt.verify(bearerMatch[1], process.env.JWT_SECRET, (error, user) => {
            if (error) {
                return res.status(403).json({ message: 'Invalid or expired token.' });
            }

            req.user = user;
            return next();
        });
    };
};

module.exports = requireAuth;
