'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const {
    getCurrentSeason,
    getFinalizedSeason,
    listFinalizedSeasons,
} = require('../services/seasonService');

module.exports = function createSeasonRoutes(pool, jwt) {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    router.get('/current', checkAuth, async (req, res) => {
        try {
            res.json(await getCurrentSeason(pool));
        } catch (error) {
            console.error('Failed to load current season:', error);
            res.status(500).json({ message: 'Unable to load the current season.' });
        }
    });

    router.get('/', checkAuth, async (req, res) => {
        try {
            res.json({ seasons: await listFinalizedSeasons(pool) });
        } catch (error) {
            console.error('Failed to list season archives:', error);
            res.status(500).json({ message: 'Unable to load season archives.' });
        }
    });

    router.get('/:identifier', checkAuth, async (req, res) => {
        try {
            const archive = await getFinalizedSeason(pool, req.params.identifier);
            if (!archive) return res.status(404).json({ message: 'Season archive not found.' });
            return res.json(archive);
        } catch (error) {
            console.error('Failed to load season archive:', error);
            return res.status(500).json({ message: 'Unable to load season archive.' });
        }
    });

    return router;
};
