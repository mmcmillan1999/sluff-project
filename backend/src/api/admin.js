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

// This function creates the router and gives it the database pool
const createAdminRoutes = (pool, jwt, io = null) => {
  const router = express.Router();
  const checkAuth = requireAuth(pool, jwt);

  // A middleware to check if the user is an admin
  const isAdmin = (req, res, next) => {
    if (req.user?.is_admin === true) return next();
    return res.status(403).send('Access Forbidden: Requires admin privileges.');
  };

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
