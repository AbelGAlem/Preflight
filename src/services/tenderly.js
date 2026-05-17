const axios = require('axios');
const { TENDERLY_NODE_ACCESS_KEY } = require('../config');

const NETWORK_PREFIXES = {
  1: 'mainnet',
  11155111: 'sepolia',
  8453: 'base',
  137: 'polygon',
};

const NATIVE_TOKENS = {
  1: 'ETH',
  11155111: 'ETH',
  8453: 'ETH',
  137: 'MATIC',
};

// Fallback gas prices in wei when Tenderly doesn't return effectiveGasPrice
const GAS_PRICE_FALLBACKS = {
  1: 20e9,    // 20 gwei — Ethereum
  11155111: 2e9,
  8453: 5e6,  // 0.005 gwei — Base L2
  137: 50e9,  // 50 gwei — Polygon
};

function getRpcUrl(chainId) {
  const prefix = NETWORK_PREFIXES[chainId];
  if (!prefix) throw new Error(`Unsupported chainId: ${chainId}`);
  return `https://${prefix}.gateway.tenderly.co/${TENDERLY_NODE_ACCESS_KEY}`;
}

function toHex(value) {
  return '0x' + BigInt(value || 0).toString(16);
}

// On a revert Tenderly leaves the top level empty and spreads the reason
// across flat trace frames: one frame carries the specific message in
// `error` while another has a generic `error` plus the decoded reason in
// `errorReason`. Depth is not a reliable signal, so collect every candidate
// (decoded `errorReason` first, then `error`, then any top-level fields) and
// return the first that isn't a generic placeholder.
const GENERIC_REVERTS = new Set(['execution reverted', 'reverted', 'transaction reverted']);

function extractRevertReason(result) {
  const frames = Array.isArray(result.trace) ? result.trace : [];

  const candidates = [
    ...frames.map((f) => f.errorReason),
    ...frames.map((f) => f.error),
    result.error?.data?.message,
    result.error?.message,
    typeof result.error === 'string' ? result.error : undefined,
    result.revertReason,
    result.errorMessage,
  ].filter((c) => typeof c === 'string' && c.trim().length > 0);

  const specific = candidates.find((c) => !GENERIC_REVERTS.has(c.trim().toLowerCase()));
  return specific || candidates[0] || 'Transaction reverted';
}

async function simulateTransaction({ from, to, data, value, chainId }) {
  const rpcUrl = getRpcUrl(chainId);
  let response;
  try {
    response = await axios.post(rpcUrl, {
      id: 0,
      jsonrpc: '2.0',
      method: 'tenderly_simulateTransaction',
      params: [
        {
          from,
          to,
          gas: '0x7a1200',
          value: toHex(value),
          data: data || '0x',
        },
        'latest',
      ],
    });
  } catch (axiosErr) {
    console.error('[tenderly] HTTP error:', axiosErr.response?.status, JSON.stringify(axiosErr.response?.data));
    throw new Error(`Tenderly HTTP ${axiosErr.response?.status}: ${JSON.stringify(axiosErr.response?.data)}`);
  }

  const { result, error } = response.data;

  if (error) {
    throw new Error(error.message || 'Tenderly RPC error');
  }

  const success = result.status === true || result.status === '0x1' || result.status === 1;
  const gasUsed = result.gasUsed ? parseInt(result.gasUsed, 16) : null;
  const effectiveGasPrice = result.effectiveGasPrice
    ? parseInt(result.effectiveGasPrice, 16)
    : GAS_PRICE_FALLBACKS[chainId] || 20e9;

  const revertReason = !success ? extractRevertReason(result) : null;

  const logs = (result.logs || []).map((log) => ({
    address: log.address,
    topics: log.topics,
    data: log.data,
  }));

  return {
    success,
    gasEstimate: gasUsed,
    effectiveGasPrice,
    nativeToken: NATIVE_TOKENS[chainId] || 'ETH',
    revertReason,
    logs,
  };
}

module.exports = { simulateTransaction };
