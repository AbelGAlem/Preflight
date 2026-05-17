const { paymentMiddleware } = require('x402-express');
const { WALLET_ADDRESS, PRICE_PER_REQUEST, PAYMENT_NETWORK, PAYMENT_FACILITATOR_URL } = require('../config');

const PROTECTED_METHOD = 'POST';
const PROTECTED_PATH = '/simulate';
const MCP_PATH = '/mcp';
const PAID_MCP_TOOL = 'preflight_simulate';
const SUPPORTED_NETWORKS = new Set(['base', 'base-sepolia']);
const BASE64_PAYMENT_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

function normalizeUsdPrice(value) {
  return String(value || '').trim().replace(/^\$/, '');
}

function formatUsdPrice(value) {
  return `$${normalizeUsdPrice(value)}`;
}

function isEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(value || '');
}

function isProbablyBase64Payment(value) {
  const payment = String(value || '').trim();
  return payment.length > 0
    && payment.length % 4 === 0
    && BASE64_PAYMENT_REGEX.test(payment);
}

function getConfigError() {
  if (!isEvmAddress(WALLET_ADDRESS)) {
    return 'WALLET_ADDRESS must be a valid EVM address before paid simulations are available';
  }

  if (!SUPPORTED_NETWORKS.has(PAYMENT_NETWORK)) {
    return `PAYMENT_NETWORK must be one of: ${Array.from(SUPPORTED_NETWORKS).join(', ')}`;
  }

  const numericPrice = Number(normalizeUsdPrice(PRICE_PER_REQUEST));
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
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
          nativeToken: { type: ['string', 'null'] },
          gasCostNative: { type: ['string', 'null'] },
          gasCostUSD: { type: ['string', 'null'] },
          logs: { type: 'array' },
          revertReason: { type: ['string', 'null'] },
          simulatedAt: { type: 'string' },
        },
      },
    },
  },
  [MCP_PATH]: {
    price: formatUsdPrice(PRICE_PER_REQUEST),
    network: PAYMENT_NETWORK,
    config: {
      description: `Invoke the PreFlight ${PAID_MCP_TOOL} MCP tool (one paid simulation per tools/call)`,
      mimeType: 'application/json',
      maxTimeoutSeconds: 60,
    },
  },
};

const facilitatorConfig = PAYMENT_FACILITATOR_URL
  ? { url: PAYMENT_FACILITATOR_URL }
  : undefined;

const x402Payment = paymentConfigError
  ? null
  : paymentMiddleware(WALLET_ADDRESS, routeConfig, facilitatorConfig);

const paymentConfig = {
  path: PROTECTED_PATH,
  method: PROTECTED_METHOD,
  price: routeConfig[PROTECTED_PATH].price,
  network: PAYMENT_NETWORK,
  facilitatorUrl: PAYMENT_FACILITATOR_URL || 'default',
  configured: !paymentConfigError,
};

if (paymentConfigError) {
  paymentConfig.error = paymentConfigError;
}

// Only a JSON-RPC `tools/call` for the paid tool is billable. MCP discovery
// (`initialize`, `tools/list`) and notifications stay free so agents — and the
// x402 client wrappers that auto-pay — can complete the handshake unpaid.
function isPaidMcpCall(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (m) => m
      && m.method === 'tools/call'
      && m.params
      && m.params.name === PAID_MCP_TOOL
  );
}

function payment(req, res, next) {
  const isPaidRest = req.method === PROTECTED_METHOD && req.path === PROTECTED_PATH;
  const isPaidMcp = req.method === PROTECTED_METHOD
    && req.path === MCP_PATH
    && isPaidMcpCall(req.body);

  if (!isPaidRest && !isPaidMcp) {
    return next();
  }

  if (paymentConfigError) {
    return res.status(503).json({
      error: 'x402 payments are not configured',
      detail: paymentConfigError,
    });
  }

  const paymentHeader = req.header('X-PAYMENT');
  if (paymentHeader && !isProbablyBase64Payment(paymentHeader)) {
    return res.status(400).json({
      error: 'Invalid X-PAYMENT header',
      detail: 'Use a real x402 payment payload. The placeholder in test.http is not a valid payment.',
    });
  }

  return x402Payment(req, res, next);
}

module.exports = {
  payment,
  paymentConfig,
};
