// backend/src/api/admin.js
// This file handles admin-specific routes, such as generating the database schema

const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const securityMonitor = require('../utils/securityMonitor');

// This function creates the router and gives it the database pool
const createAdminRoutes = (pool, jwt) => {
  const router = express.Router();
 
  const checkAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).send('Authentication required.');
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).send('Invalid or expired token.');
      }
      req.user = user;
      next();
    });
  };
  // A middleware to check if the user is an admin
  const isAdmin = async (req, res, next) => {
    // This assumes you have a way to get the user's ID from the request,
    // for example, from a decoded JWT token attached by another middleware.
    // Since your io.use middleware handles JWT, a separate one for Express is needed.
    // For now, we'll placeholder this logic.
    const userId = req.user?.id;
    if (!userId) return res.status(401).send('Authentication required.');

    try {
      const { rows } = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
      if (rows.length > 0 && rows[0].is_admin) {
        return next();
      }
      res.status(403).send('Access Forbidden: Requires admin privileges.');
    } catch (err) {
      console.error("Admin check failed:", err);
      res.status(500).send('Server error during admin check.');
    }
  };

  // Middleware to check if user is admin
  const requireAdmin = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
          if (err) return res.status(403).json({ error: 'Invalid token' });
          if (!user.is_admin) return res.status(403).json({ error: 'Admin access required' });
          req.user = user;
          next();
      });
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