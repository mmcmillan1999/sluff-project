// backend/src/api/ai.js

const express = require('express');
// --- PATH CORRECTION ---
const aiTools = require('../services/ai_tools');

const availableTools = {
  getTableState: aiTools.getTableState,
  getUserByUsername: aiTools.getUserByUsername,
};

// --- MODIFICATION: Accept gameService instance ---
const createAiRoutes = (pool, gameService) => {
  const router = express.Router();

  const checkAiAuth = (req, res, next) => {
    const secret = req.headers['x-ai-secret-key'];
    if (!secret || secret !== process.env.AI_SECRET_KEY) {
      return res.status(403).json({ error: 'Forbidden: Invalid AI secret key.' });
    }
    next();
  };

  router.post('/execute-tool', checkAiAuth, async (req, res) => {
    const { name, args } = req.body.functionCall;

    const tool = availableTools[name];

    if (!tool) {
      return res.status(404).json({ error: `Tool with name '${name}' not found.` });
    }

    try {
      // --- MODIFICATION: Pass gameService to the tool ---
      const result = await tool(args, pool, gameService);

      res.json({
        functionResponse: {
          name,
          response: result,
        },
      });
    } catch (error) {
      console.error(`Error executing tool '${name}':`, error);
      res.status(500).json({ error: 'An internal server error occurred.' });
    }
  });

  return router;
};

module.exports = createAiRoutes;