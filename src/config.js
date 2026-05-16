require('dotenv').config();

module.exports = {
  TENDERLY_NODE_ACCESS_KEY: process.env.TENDERLY_NODE_ACCESS_KEY,
  WALLET_ADDRESS: process.env.WALLET_ADDRESS,
  PRICE_PER_REQUEST: process.env.PRICE_PER_REQUEST || '0.01',
  PAYMENT_NETWORK: process.env.PAYMENT_NETWORK || 'base-sepolia',
  PAYMENT_FACILITATOR_URL: process.env.PAYMENT_FACILITATOR_URL,
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};
