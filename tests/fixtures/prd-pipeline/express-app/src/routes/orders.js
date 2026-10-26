const { Router } = require('express');

const router = Router();

router.get('/', (req, res) => res.json([]));
router.post('/', (req, res) => res.status(201).end());
router.route('/:id').get((req, res) => res.json({}));
router.delete('/:id', (req, res) => res.status(204).end());

module.exports = router;
