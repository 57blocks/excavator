const express = require('express');
const ordersRouter = require('./routes/orders');
const archiveRouter = require('./routes/archive');

const app = express();
app.use('/orders', ordersRouter);
app.use('/archive', archiveRouter);
app.get('/health', (req, res) => res.json({ ok: true }));

module.exports = app;
