const { simulateTransaction } = require('./tenderly');
const { getNativePriceUSD } = require('./ethPrice');

const GAS_REVIEW_THRESHOLD = 500000;
const USD_REVIEW_THRESHOLD = 10;

async function simulateWithPricing(transaction) {
  const result = await simulateTransaction(transaction);

  const gasCostNative = result.gasEstimate != null && result.effectiveGasPrice != null
    ? ((result.gasEstimate * result.effectiveGasPrice) / 1e18).toFixed(8)
    : null;

  const nativePrice = await getNativePriceUSD(result.nativeToken);
  const gasCostUSD = gasCostNative && nativePrice
    ? (parseFloat(gasCostNative) * nativePrice).toFixed(4)
    : null;

  return {
    success: result.success,
    gasEstimate: result.gasEstimate,
    nativeToken: result.nativeToken,
    gasCostNative,
    gasCostUSD,
    logs: result.logs,
    revertReason: result.revertReason,
    simulatedAt: new Date().toISOString(),
  };
}

function assessSimulation(simulation) {
  if (!simulation.success) {
    return {
      decision: 'abort',
      riskLevel: 'high',
      reason: simulation.revertReason || 'The transaction simulation failed.',
      recommendation: 'Do not submit this transaction unless the failure is understood and corrected.',
      simulation,
    };
  }

  if (simulation.gasEstimate == null) {
    return {
      decision: 'review',
      riskLevel: 'medium',
      reason: 'The transaction succeeded, but no gas estimate was returned.',
      recommendation: 'Review the transaction manually before submitting it on-chain.',
      simulation,
    };
  }

  if (simulation.gasEstimate > GAS_REVIEW_THRESHOLD) {
    return {
      decision: 'review',
      riskLevel: 'medium',
      reason: `The gas estimate is high at ${simulation.gasEstimate} gas.`,
      recommendation: 'Review the gas usage and confirm the transaction is expected to be this expensive.',
      simulation,
    };
  }

  const gasCostUSD = simulation.gasCostUSD == null ? null : Number(simulation.gasCostUSD);
  if (gasCostUSD != null && Number.isFinite(gasCostUSD) && gasCostUSD > USD_REVIEW_THRESHOLD) {
    return {
      decision: 'review',
      riskLevel: 'medium',
      reason: `The estimated gas cost is high at $${simulation.gasCostUSD}.`,
      recommendation: 'Review current network fees and confirm the transaction should be submitted now.',
      simulation,
    };
  }

  return {
    decision: 'proceed',
    riskLevel: 'low',
    reason: 'The transaction simulation succeeded and the estimated cost is within the review thresholds.',
    recommendation: 'Proceed if the transaction intent and recipient are correct.',
    simulation,
  };
}

async function assessTransaction(transaction) {
  const simulation = await simulateWithPricing(transaction);
  return assessSimulation(simulation);
}

module.exports = {
  simulateWithPricing,
  assessSimulation,
  assessTransaction,
};
