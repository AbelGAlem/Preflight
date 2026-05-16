require('dotenv').config();

module.exports = {
  TENDERLY_NODE_ACCESS_KEY: process.env.TENDERLY_NODE_ACCESS_KEY,
  WALLET_ADDRESS: process.env.WALLET_ADDRESS,
  PRICE_PER_REQUEST: process.env.PRICE_PER_REQUEST || '0.01',
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
};
