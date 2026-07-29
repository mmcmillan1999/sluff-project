// backend/src/api/admin.js
// This file handles admin-specific routes, such as generating the database schema

const express = require('express');
const fs = require('fs');
const path = require('path');
const securityMonitor = require('../utils/securityMonitor');
const requireAuth = require('../middleware/requireAuth');
const {
  SeasonConflictError,
  finalizeRollover,
  previewRollover,
} = require('../services/seasonService');
const {
  Alpha2WalletResetConflictError,
  applyAlpha2WalletReset,
  previewAlpha2WalletReset,
} = require('../services/alpha2WalletResetService');
const {
  AdminGameRecoveryConflictError,
  applyAdminGameRecovery,
  previewAdminGameRecovery,
} = require('../services/adminGameRecoveryService');

// This function creates the router and gives it the database pool
const createAdminRoutes = (pool, jwt, io = null, options = {}) => {
  const router = express.Router();
  const checkAuth = requireAuth(pool, jwt);
  const previewGameRecovery = options.previewGameRecovery || previewAdminGameRecovery;
  const applyGameRecovery = options.applyGameRecovery || applyAdminGameRecovery;
  const getLiveGameIds = typeof options.getLiveGameIds === 'function'
    ? options.getLiveGameIds
    : () => [];

  // A middleware to check if the user is an admin
  const isAdmin = (req, res, next) => {
    if (req.user?.is_admin === true) return next();
    return res.status(403).send('Access Forbidden: Requires admin privileges.');
  };

  // --- Chat moderation queue (App Store guideline 1.2) -------------------
  // The Terms have always promised suspension; until now nothing here could
  // deliver it, which made the promise the only moderation the app had.

  // GET /api/admin/chat-reports - open reports, newest first.
  router.get('/chat-reports', checkAuth, isAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.message_id, r.reason, r.message_snapshot, r.created_at,
                r.reported_user_id, reported.username AS reported_username,
                r.reporter_user_id, reporter.username AS reporter_username,
                COALESCE(m.hidden, TRUE) AS message_hidden,
                reported.chat_muted_until
         FROM chat_reports r
         LEFT JOIN users reported ON reported.id = r.reported_user_id
         LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
         LEFT JOIN lobby_chat_messages m ON m.id = r.message_id
         WHERE r.resolved_at IS NULL
         ORDER BY r.created_at DESC
         LIMIT 100`,
      );
      res.set('Cache-Control', 'private, no-store');
      return res.json({ reports: rows });
    } catch (error) {
      console.error('Failed to load chat reports:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/admin/chat-reports/:id/resolve  { hideMessage, muteHours }
  router.post('/chat-reports/:id/resolve', checkAuth, isAdmin, async (req, res) => {
    const reportId = Number(req.params.id);
    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ error: 'A report id is required.' });
    }
    const hideMessage = req.body?.hideMessage === true;
    const muteHours = Number(req.body?.muteHours) || 0;
    if (!Number.isFinite(muteHours) || muteHours < 0 || muteHours > 24 * 365) {
      return res.status(400).json({ error: 'Mute duration is out of range.' });
    }

    const client = await pool.connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;

      const found = await client.query(
        'SELECT message_id, reported_user_id FROM chat_reports WHERE id = $1 FOR UPDATE',
        [reportId],
      );
      const report = found.rows?.[0];
      if (!report) {
        await client.query('ROLLBACK');
        open = false;
        return res.status(404).json({ error: 'Report not found.' });
      }

      if (hideMessage && report.message_id) {
        await client.query(
          'UPDATE lobby_chat_messages SET hidden = TRUE WHERE id = $1',
          [report.message_id],
        );
      }
      if (muteHours > 0 && report.reported_user_id) {
        await client.query(
          `UPDATE users
           SET chat_muted_until = GREATEST(
                 COALESCE(chat_muted_until, NOW()), NOW()
               ) + ($1 || ' hours')::interval
           WHERE id = $2`,
          [String(muteHours), report.reported_user_id],
        );
      }
      // Resolving one report on a message resolves every report on it: the
      // decision was about the message, not about who happened to flag it.
      await client.query(
        `UPDATE chat_reports SET resolved_at = NOW()
         WHERE resolved_at IS NULL AND (id = $1 OR ($2::int IS NOT NULL AND message_id = $2))`,
        [reportId, report.message_id],
      );

      await client.query('COMMIT');
      open = false;
      console.log(`[ADMIN] chat report ${reportId} resolved by ${req.user.username}`
        + `${hideMessage ? ' (message hidden)' : ''}${muteHours > 0 ? ` (muted ${muteHours}h)` : ''}`);
      return res.json({ resolved: true, hidden: hideMessage, muteHours });
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) {
          console.error('Report-resolve rollback failed:', rollbackError.message);
        }
      }
      console.error('Failed to resolve chat report:', error);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  });

  // GET /api/admin/mercy-token-report
  router.get('/mercy-token-report', checkAuth, isAdmin, async (req, res) => {
    try {
      const { hours = 24 } = req.query;
      
      const report = await securityMonitor.generateSecurityReport(pool, parseInt(hours));
      
      if (report.error) {
        return res.status(500).json({ error: 'Failed to generate report', details: report.error });
      }
      
      res.json({
        success: true,
        report,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user.username
      });
      
    } catch (error) {
      console.error('Error generating mercy token report:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/admin/user-suspicious-activity/:userId
  router.get('/user-suspicious-activity/:userId', checkAuth, isAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      
      if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      
      const suspiciousCheck = await securityMonitor.checkSuspiciousActivity(pool, parseInt(userId));
      
      res.json({
        success: true,
        userId: parseInt(userId),
        suspiciousActivity: suspiciousCheck,
        checkedAt: new Date().toISOString(),
        checkedBy: req.user.username
      });
      
    } catch (error) {
      console.error('Error checking suspicious activity:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/seasons/rollover-preview', checkAuth, isAdmin, async (req, res) => {
    try {
      res.json(await previewRollover(pool));
    } catch (error) {
      console.error('Failed to preview season rollover:', error);
      res.status(500).json({ message: 'Unable to preview season rollover.' });
    }
  });

  router.post('/seasons/rollover', checkAuth, isAdmin, async (req, res) => {
    try {
      const result = await finalizeRollover(pool, {
        expectedPreviewHash: req.body?.expectedPreviewHash,
        expectedSeasonId: req.body?.expectedSeasonId,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof SeasonConflictError) {
        return res.status(409).json({ code: error.code, message: error.message });
      }
      if (error?.code === 'PREVIEW_HASH_REQUIRED' || error instanceof TypeError) {
        return res.status(400).json({ code: error.code || 'INVALID_REQUEST', message: error.message });
      }
      // PostgreSQL uses 40001 when a serializable transaction loses a race.
      if (error?.code === '40001') {
        return res.status(409).json({
          code: 'ROLLOVER_RACE',
          message: 'Season data changed during rollover. Preview again before retrying.',
        });
      }
      console.error('Failed to finalize season rollover:', error);
      return res.status(500).json({ message: 'Unable to finalize season rollover.' });
    }
  });

  router.get('/seasons/alpha-2-wallet-reset-preview', checkAuth, isAdmin, async (req, res) => {
    try {
      return res.json(await previewAlpha2WalletReset(pool));
    } catch (error) {
      if (error instanceof Alpha2WalletResetConflictError) {
        return res.status(409).json({ code: error.code, message: error.message });
      }
      console.error('Failed to preview the Alpha Season 2 wallet reset:', error);
      return res.status(500).json({ message: 'Unable to preview the Alpha Season 2 wallet reset.' });
    }
  });

  router.post('/seasons/alpha-2-wallet-reset', checkAuth, isAdmin, async (req, res) => {
    try {
      const result = await applyAlpha2WalletReset(pool, {
        expectedPreviewHash: req.body?.expectedPreviewHash,
        expectedSeasonId: req.body?.expectedSeasonId,
        appliedBy: req.user,
      });
      if (!result.alreadyApplied && io && typeof io.emit === 'function') {
        try {
          io.emit('tokenBalancesReset', {
            seasonId: result.season.id,
            targetTokens: result.targetTokens,
          });
        } catch (broadcastError) {
          // The ledger commit is authoritative. A transient socket broadcast
          // failure must not misreport a completed reset as a database failure;
          // clients also refresh balances on their next normal sync.
          console.error('Wallet reset committed but balance broadcast failed:', broadcastError);
        }
      }
      return res.status(result.alreadyApplied ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof Alpha2WalletResetConflictError) {
        return res.status(409).json({ code: error.code, message: error.message });
      }
      if (error?.code === 'PREVIEW_HASH_REQUIRED' || error instanceof TypeError) {
        return res.status(400).json({ code: error.code || 'INVALID_REQUEST', message: error.message });
      }
      // PostgreSQL serialization and unique-key races are reported as a safe
      // conflict so an operator refreshes rather than guessing at state.
      if (error?.code === '40001' || error?.code === '23505') {
        return res.status(409).json({
          code: 'WALLET_RESET_RACE',
          message: 'Wallet state changed during the reset. Refresh the preview before retrying.',
        });
      }
      console.error('Failed to apply the Alpha Season 2 wallet reset:', error);
      return res.status(500).json({ message: 'Unable to apply the Alpha Season 2 wallet reset.' });
    }
  });

  router.get('/game-recovery/preview', checkAuth, isAdmin, async (req, res) => {
    try {
      const excludeGameIds = await getLiveGameIds();
      res.set('Cache-Control', 'no-store');
      return res.json(await previewGameRecovery(pool, { excludeGameIds }));
    } catch (error) {
      console.error('Failed to preview abandoned-game refunds:', error);
      return res.status(500).json({ message: 'Unable to prepare the abandoned-game refund preview.' });
    }
  });

  router.post('/game-recovery/refund', checkAuth, isAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const excludeGameIds = await getLiveGameIds();
      const result = await applyGameRecovery(pool, {
        gameIds: req.body?.gameIds,
        expectedPreviewHash: req.body?.expectedPreviewHash,
        excludeGameIds,
        appliedBy: req.user,
      });

      if (result.refundedGameCount > 0 && io && typeof io.emit === 'function') {
        try {
          io.emit('tokenBalancesReset', {
            reason: 'abandoned-game-refund',
            gameIds: result.results
              .filter(item => item.status === 'abandoned_refunded' && item.alreadyReconciled !== true)
              .map(item => item.gameId),
          });
        } catch (broadcastError) {
          console.error('Game refunds committed but balance broadcast failed:', broadcastError);
        }
      }

      if (result.outcome === 'unknown') {
        return res.status(503).json({
          ...result,
          message: 'One or more refund results are unknown. Refresh the preview and ledger before retrying.',
        });
      }
      if (result.outcome === 'not_refunded') {
        return res.status(409).json({
          ...result,
          message: 'One or more selected games changed. Refresh and review the remaining games.',
        });
      }
      if (result.outcome === 'partial' || result.outcome === 'partial_unknown') {
        return res.status(207).json({
          ...result,
          message: result.outcome === 'partial_unknown'
            ? 'Some refunds completed and one or more results are unknown. Refresh before taking another action.'
            : 'Some refunds completed and some selected games changed. Refresh before taking another action.',
        });
      }
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof AdminGameRecoveryConflictError) {
        return res.status(409).json({ code: error.code, message: error.message });
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        return res.status(400).json({ code: 'INVALID_RECOVERY_REQUEST', message: error.message });
      }
      console.error('Failed to refund abandoned games:', error);
      return res.status(500).json({ message: 'Unable to refund the selected abandoned games.' });
    }
  });

 router.post('/generate-schema', checkAuth, isAdmin, async (req, res) => {
    try {
      const sqlQuery = `
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;
      `;
      const { rows } = await pool.query(sqlQuery);

      let markdownContent = '# Database Schema\n\n';
      let currentTable = '';
      rows.forEach(row => {
        if (row.table_name !== currentTable) {
          currentTable = row.table_name;
          markdownContent += `\n## \`${currentTable}\`\n`;
        }
        markdownContent += `- **${row.column_name}**: \`${row.data_type}\`\n`;
      });

      // Writes the file to the project's root directory
      const filePath = path.join(__dirname, '../DATABASE_SCHEMA.md'); 
      fs.writeFileSync(filePath, markdownContent);

      res.status(200).send('DATABASE_SCHEMA.md updated successfully.');

    } catch (error) {
      console.error('Failed to generate schema file:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  return router;
};

module.exports = createAdminRoutes;
