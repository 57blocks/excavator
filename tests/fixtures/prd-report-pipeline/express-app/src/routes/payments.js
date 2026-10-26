const express = require('express');

const router = express.Router();

router.post(
  '/payments',
  (req, res) => res.status(201).end(),
);
router.get('/payments/:id', (req, res) => res.json({}));

module.exports = router;
