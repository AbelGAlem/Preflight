const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { payment } = require('./middleware/payment');
const simulateRouter = require('./routes/simulate');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.use(payment);
app.use('/simulate', simulateRouter);

app.listen(PORT, () => {
  console.log(`PreFlight running on port ${PORT}`);
});
