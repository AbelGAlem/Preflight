import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assessSimulation } = require('../src/services/preflight');

const baseSimulation = {
  success: true,
  gasEstimate: 21000,
  nativeToken: 'ETH',
  gasCostNative: '0.00042000',
  gasCostUSD: '1.0000',
  logs: [],
  revertReason: null,
  simulatedAt: '2026-05-17T00:00:00.000Z',
};

const cases = [
  {
    name: 'failed simulation aborts',
    simulation: { ...baseSimulation, success: false, revertReason: 'execution reverted' },
    decision: 'abort',
    riskLevel: 'high',
  },
  {
    name: 'missing gas estimate reviews',
    simulation: { ...baseSimulation, gasEstimate: null },
    decision: 'review',
    riskLevel: 'medium',
  },
  {
    name: 'gas estimate at threshold proceeds',
    simulation: { ...baseSimulation, gasEstimate: 500000 },
    decision: 'proceed',
    riskLevel: 'low',
  },
  {
    name: 'gas estimate above threshold reviews',
    simulation: { ...baseSimulation, gasEstimate: 500001 },
    decision: 'review',
    riskLevel: 'medium',
  },
  {
    name: 'gas USD at threshold proceeds',
    simulation: { ...baseSimulation, gasCostUSD: '10.0000' },
    decision: 'proceed',
    riskLevel: 'low',
  },
  {
    name: 'gas USD above threshold reviews',
    simulation: { ...baseSimulation, gasCostUSD: '10.0001' },
    decision: 'review',
    riskLevel: 'medium',
  },
  {
    name: 'normal simulation proceeds',
    simulation: baseSimulation,
    decision: 'proceed',
    riskLevel: 'low',
  },
];

for (const testCase of cases) {
  const result = assessSimulation(testCase.simulation);
  assert.equal(result.decision, testCase.decision, testCase.name);
  assert.equal(result.riskLevel, testCase.riskLevel, testCase.name);
  assert.equal(typeof result.reason, 'string', testCase.name);
  assert.equal(typeof result.recommendation, 'string', testCase.name);
  assert.deepEqual(result.simulation, testCase.simulation, testCase.name);
  console.log(`PASS ${testCase.name}`);
}
