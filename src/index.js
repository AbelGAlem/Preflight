const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { payment, paymentConfig } = require('./middleware/payment');
const simulateRouter = require('./routes/simulate');
const { createMcpRouter } = require('./mcp/server');

const app = express();

app.use(cors({
  origin: true,
  allowedHeaders: ['Content-Type', 'Accept', 'X-PAYMENT', 'PAYMENT-SIGNATURE'],
  exposedHeaders: ['X-PAYMENT-RESPONSE', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE', 'WWW-Authenticate'],
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.get('/payment', (req, res) => {
  res.json(paymentConfig);
});

app.use(payment);
app.use('/simulate', simulateRouter);
app.use('/mcp', createMcpRouter());

app.listen(PORT, () => {
  console.log(`PreFlight running on port ${PORT}`);
});
