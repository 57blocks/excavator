const { Router } = require('express');

const router = Router();

router.get('/archive', (req, res) => res.json([]));

module.exports = router;
