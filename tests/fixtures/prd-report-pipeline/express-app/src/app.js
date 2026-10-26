const express = require('express');
const ordersRouter = require('./routes/orders');

const app = express();
app.set('port', 3000);
app.get('port');
app.use('/orders', ordersRouter);
app.get('/health', (req, res) => res.json({ ok: true }));

module.exports = app;
