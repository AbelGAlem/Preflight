const axios = require('axios');
const { TENDERLY_NODE_ACCESS_KEY } = require('../config');

const NETWORK_PREFIXES = {
  1: 'mainnet',
  8453: 'base',
  137: 'polygon',
};

function getRpcUrl(chainId) {
  const prefix = NETWORK_PREFIXES[chainId];
  if (!prefix) throw new Error(`Unsupported chainId: ${chainId}`);
  return `https://${prefix}.gateway.tenderly.co/${TENDERLY_NODE_ACCESS_KEY}`;
}

function toHex(value) {
  return '0x' + BigInt(value || 0).toString(16);
}

async function simulateTransaction({ from, to, data, value, chainId }) {
  const rpcUrl = getRpcUrl(chainId);

  const response = await axios.post(rpcUrl, {
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

  const { result, error } = response.data;

  if (error) {
    throw new Error(error.message || 'Tenderly RPC error');
  }

  const success = result.status === '0x1';
  const gasUsed = result.gasUsed ? parseInt(result.gasUsed, 16) : null;

  const revertReason = !success
    ? (result.error?.message || result.revertReason || 'Transaction reverted')
    : null;

  const logs = (result.logs || []).map((log) => ({
    address: log.address,
    topics: log.topics,
    data: log.data,
  }));

  return {
    success,
    gasEstimate: gasUsed,
    revertReason,
    logs,
  };
}

module.exports = { simulateTransaction };
