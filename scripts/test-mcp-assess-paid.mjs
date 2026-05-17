import 'dotenv/config';
import axios from 'axios';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { decodeXPaymentResponse, withPaymentInterceptor } from 'x402-axios';

const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
const paymentNetwork = process.env.PAYMENT_NETWORK || 'base-sepolia';
const baseURL = process.env.PREFLIGHT_URL || `http://localhost:${process.env.PORT || 3000}`;

if (!payerPrivateKey) {
  console.error('Missing PAYER_PRIVATE_KEY in your environment.');
  console.error('Use a funded test wallet private key, not your receiving WALLET_ADDRESS key.');
  process.exit(1);
}

if (!['base', 'base-sepolia'].includes(paymentNetwork)) {
  console.error(`Unsupported PAYMENT_NETWORK for this smoke test: ${paymentNetwork}`);
  process.exit(1);
}

const normalizedPrivateKey = payerPrivateKey.startsWith('0x')
  ? payerPrivateKey
  : `0x${payerPrivateKey}`;

if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
  console.error('PAYER_PRIVATE_KEY must be a 32-byte hex private key.');
  process.exit(1);
}

const account = privateKeyToAccount(normalizedPrivateKey);
const chain = paymentNetwork === 'base' ? base : baseSepolia;

const walletClient = createWalletClient({ account, chain, transport: http() });

function parseMcpResponse(data) {
  if (data && typeof data === 'object') return data;

  const line = String(data)
    .split('\n')
    .find((l) => l.startsWith('data:'));

  if (!line) {
    throw new Error(`Unexpected MCP response: ${String(data).slice(0, 200)}`);
  }

  return JSON.parse(line.slice(5).trim());
}

function parseToolTextJson(mcpMessage) {
  const text = mcpMessage?.result?.content?.find((item) => item.type === 'text')?.text;

  if (!text) {
    throw new Error(`Missing MCP text content: ${JSON.stringify(mcpMessage)}`);
  }

  return JSON.parse(text);
}

function assertAssessmentShape(assessment) {
  const decisions = new Set(['proceed', 'review', 'abort']);
  const riskLevels = new Set(['low', 'medium', 'high']);

  if (!decisions.has(assessment.decision)) {
    throw new Error(`Invalid decision: ${assessment.decision}`);
  }

  if (!riskLevels.has(assessment.riskLevel)) {
    throw new Error(`Invalid riskLevel: ${assessment.riskLevel}`);
  }

  if (typeof assessment.reason !== 'string' || assessment.reason.length === 0) {
    throw new Error('Missing reason');
  }

  if (typeof assessment.recommendation !== 'string' || assessment.recommendation.length === 0) {
    throw new Error('Missing recommendation');
  }

  if (!assessment.simulation || typeof assessment.simulation.success !== 'boolean') {
    throw new Error('Missing simulation result');
  }
}

const mcpHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

const plain = axios.create({ baseURL, proxy: false });
const paid = withPaymentInterceptor(axios.create({ baseURL, proxy: false }), walletClient);

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

try {
  console.log(`MCP target: ${baseURL}/mcp  payer: ${account.address}  network: ${paymentNetwork}\n`);

  console.log('1. initialize (free)...');
  const init = await plain.post('/mcp', rpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-mcp-assess-paid', version: '1.0.0' },
  }), { headers: mcpHeaders });
  console.log('   ->', JSON.stringify(parseMcpResponse(init.data).result.serverInfo), '\n');

  console.log('2. tools/list (free)...');
  const list = await plain.post('/mcp', rpc(2, 'tools/list', {}), { headers: mcpHeaders });
  const tools = parseMcpResponse(list.data).result.tools.map((t) => t.name);
  console.log('   -> tools:', tools.join(', '), '\n');

  if (!tools.includes('preflight_assess')) {
    throw new Error('preflight_assess missing from tools/list');
  }

  console.log('3. tools/call preflight_assess (paid - expect 402 then auto-pay)...');
  const callResp = await paid.post('/mcp', rpc(3, 'tools/call', {
    name: 'preflight_assess',
    arguments: {
      // Wrap 0.1 ETH into WETH - expected to succeed.
      from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      data: '0xd0e30db0',
      value: '100000000000000000',
      chainId: 1,
    },
  }), { headers: mcpHeaders });

  const paymentResponseHeader = callResp.headers['x-payment-response'];
  console.log('   payment accepted:', Boolean(paymentResponseHeader));

  if (!paymentResponseHeader) {
    throw new Error('Missing x-payment-response header after paid MCP call');
  }

  console.log('   payment response:', JSON.stringify(decodeXPaymentResponse(paymentResponseHeader), null, 2));

  const mcpMessage = parseMcpResponse(callResp.data);
  const assessment = parseToolTextJson(mcpMessage);
  assertAssessmentShape(assessment);

  console.log('   assessment:', JSON.stringify(assessment, null, 2));
  console.log('\nPaid preflight_assess smoke test passed.');
} catch (error) {
  if (error.response) {
    console.error(`Request failed with HTTP ${error.response.status}`);
    console.error(JSON.stringify(error.response.data, null, 2));

    if (error.response.status === 402 && error.response.data?.error?.includes('insufficient_balance')) {
      const [requirement] = error.response.data.accepts || [];
      if (requirement) {
        console.error(`Fund ${error.response.data.payer} with at least ${Number(requirement.maxAmountRequired) / 1e6} USDC on ${requirement.network}.`);
        console.error(`USDC token: ${requirement.asset}`);
      }
    }
  } else {
    console.error(error.message);
  }

  process.exit(1);
}
