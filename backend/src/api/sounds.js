// backend/src/api/sounds.js
// Personalized audio for game moments. The champion line never accepts a
// name from the request: the server looks up the caller's table and speaks
// only the name IT knows won — so player-supplied text can never reach TTS
// through this surface.

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { getChampionLine } = require('../services/championLine');
const { PLACEHOLDER_ID } = require('../core/constants');

const createSoundsRoutes = (pool, jwt, gameService) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    // GET /api/sounds/champion-line/:tableId — the winner's personalized
    // sting for a finished game at a table the caller is seated at.
    // 204 whenever no personalized line applies (shared win, forfeit,
    // unspeakable name, TTS unavailable) — the client falls back to the
    // generic pre-mixed sting.
    router.get('/champion-line/:tableId', checkAuth, async (req, res) => {
        try {
            const engine = gameService.getEngineById(req.params.tableId);
            if (!engine) return res.status(404).json({ message: 'Unknown table.' });
            const seated = Object.values(engine.players || {})
                .some(player => player.userId === req.user.id);
            if (!seated) return res.status(403).json({ message: 'Not at this table.' });
            if (engine.state !== 'Game Over' || !engine.roundSummary?.isGameOver) {
                return res.status(409).json({ message: 'The game is not over.' });
            }
            // No fanfare for forfeit handovers, and the line is written for
            // exactly one champion.
            if (engine.roundSummary?.forfeit) return res.status(204).end();
            const scores = Object.entries(engine.scores || {})
                .filter(([name]) => name && name !== PLACEHOLDER_ID)
                .map(([name, score]) => [name, Number(score)])
                .filter(([, score]) => Number.isFinite(score));
            if (scores.length === 0) return res.status(204).end();
            const topScore = Math.max(...scores.map(([, score]) => score));
            const winners = scores.filter(([, score]) => score === topScore);
            if (winners.length !== 1) return res.status(204).end();

            const audio = await getChampionLine(pool, winners[0][0]);
            if (!audio) return res.status(204).end();
            res.set('Content-Type', 'audio/mpeg');
            // Never cacheable: the URL names the TABLE, and the next game at
            // that table has a different champion. A one-hour max-age here
            // once had McSaddle's browser replay "All hail your champion,
            // Grampa Blane" on McSaddle's own win (Sept 10 2026). The client
            // keeps the decoded line in memory for the podium; the per-name
            // audio cache is champion_lines in the database.
            res.set('Cache-Control', 'private, no-store');
            return res.send(audio);
        } catch (error) {
            console.error('Error serving champion line:', error);
            return res.status(500).json({ message: 'Unable to load the champion line.' });
        }
    });

    // GET /api/sounds/tournament-welcome/:tournamentId — Liam's call to the
    // felt for a tournament the caller is entered in, while its first round
    // waits on the deal. 204 whenever there is no line (not an entrant,
    // TTS unavailable, opening over) — the client plays the fanfare alone.
    router.get('/tournament-welcome/:tournamentId', checkAuth, async (req, res) => {
        try {
            const director = gameService.tournamentDirector;
            const audio = director?.welcomeAudioFor?.(req.params.tournamentId, req.user.id) || null;
            if (!audio) return res.status(204).end();
            res.set('Content-Type', 'audio/mpeg');
            // The line is one tournament's; the next event has another.
            res.set('Cache-Control', 'private, no-store');
            return res.send(audio);
        } catch (error) {
            console.error('Error serving tournament welcome:', error);
            return res.status(500).json({ message: 'Unable to load the tournament welcome.' });
        }
    });

    return router;
};

module.exports = createSoundsRoutes;
