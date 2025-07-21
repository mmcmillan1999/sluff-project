const express = require('express');

module.exports = function() {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ message: 'pong', status: 'ok', service: 'sluff-backend' });
  });

  return router;
};