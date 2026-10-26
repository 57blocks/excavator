const { Router } = require('express');
const { createOrder, cancelOrder } = require('./service');

const router = Router();
router.post('/orders', (req, res) => res.status(201).json(createOrder(req.body)));
router.post('/orders/:id/cancel', (req, res) => res.json(cancelOrder(req.order)));

module.exports = router;
