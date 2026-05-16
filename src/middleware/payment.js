const { paymentMiddleware } = require('x402-express');
const {
  WALLET_ADDRESS,
  PRICE_PER_REQUEST,
  PAYMENT_NETWORK,
  PAYMENT_FACILITATOR_URL,
} = require('../config');

const PROTECTED_METHOD = 'POST';
const PROTECTED_PATH = '/simulate';
const SUPPORTED_NETWORKS = new Set(['base', 'base-sepolia']);

function formatUsdPrice(value) {
  const price = String(value || '').trim();
  return price.startsWith('$') ? price : `$${price}`;
}

function isEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value || '');
}

function getConfigError() {
  if (!isEvmAddress(WALLET_ADDRESS)) {
    return 'WALLET_ADDRESS must be a valid EVM address before paid simulations are available';
  }

  if (!SUPPORTED_NETWORKS.has(PAYMENT_NETWORK)) {
    return `PAYMENT_NETWORK must be one of: ${Array.from(SUPPORTED_NETWORKS).join(', ')}`;
  }

  if (!Number.isFinite(Number(PRICE_PER_REQUEST)) || Number(PRICE_PER_REQUEST) <= 0) {
    return 'PRICE_PER_REQUEST must be a positive USD amount';
  }

  return null;
}

const paymentConfigError = getConfigError();

const routeConfig = {
  [PROTECTED_PATH]: {
    price: formatUsdPrice(PRICE_PER_REQUEST),
    network: PAYMENT_NETWORK,
    config: {
      description: 'Simulate a blockchain transaction with PreFlight',
      mimeType: 'application/json',
      maxTimeoutSeconds: 60,
      outputSchema: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          gasEstimate: { type: ['number', 'null'] },
          gasCostETH: { type: ['string', 'null'] },
          gasCostUSD: { type: ['string', 'null'] },
          logs: { type: 'array' },
          revertReason: { type: ['string', 'null'] },
          simulatedAt: { type: 'string' },
        },
      },
    },
  },
};

const facilitatorConfig = PAYMENT_FACILITATOR_URL
  ? { url: PAYMENT_FACILITATOR_URL }
  : undefined;

const x402Payment = paymentConfigError
  ? null
  : paymentMiddleware(WALLET_ADDRESS, routeConfig, facilitatorConfig);

function payment(req, res, next) {
  if (req.method !== PROTECTED_METHOD || req.path !== PROTECTED_PATH) {
    return next();
  }

  if (paymentConfigError) {
    return res.status(503).json({
      error: 'x402 payments are not configured',
      detail: paymentConfigError,
    });
  }

  return x402Payment(req, res, next);
}

module.exports = {
  payment,
  paymentConfig: {
    path: PROTECTED_PATH,
    method: PROTECTED_METHOD,
    price: routeConfig[PROTECTED_PATH].price,
    network: PAYMENT_NETWORK,
    facilitatorUrl: PAYMENT_FACILITATOR_URL || 'default',
    configured: !paymentConfigError,
    error: paymentConfigError,
  },
};
