const { paymentMiddleware } = require('x402-express');
const { WALLET_ADDRESS, PRICE_PER_REQUEST, PAYMENT_NETWORK } = require('../config');

const payment = paymentMiddleware(
  WALLET_ADDRESS,
  {
    '/simulate': {
      price: `$${PRICE_PER_REQUEST}`,
      network: PAYMENT_NETWORK,
      config: {
        description: 'Simulate a blockchain transaction with PreFlight',
      },
    },
  }
);

module.exports = { payment };
