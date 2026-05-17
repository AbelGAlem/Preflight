import 'dotenv/config';
import axios from 'axios';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { withPaymentInterceptor } from 'x402-axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
const paymentNetwork = process.env.PAYMENT_NETWORK || 'base-sepolia';
const baseURL = process.env.PREFLIGHT_URL || `http://localhost:${process.env.PORT || 3000}`;

if (!payerPrivateKey) {
  throw new Error('Missing PAYER_PRIVATE_KEY in .env');
}

if (!['base', 'base-sepolia'].includes(paymentNetwork)) {
  throw new Error(`Unsupported PAYMENT_NETWORK: ${paymentNetwork}`);
}

const normalizedPrivateKey = payerPrivateKey.startsWith('0x')
  ? payerPrivateKey
  : `0x${payerPrivateKey}`;

if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
  throw new Error('PAYER_PRIVATE_KEY must be a 32-byte hex private key.');
}

const account = privateKeyToAccount(normalizedPrivateKey);
const chain = paymentNetwork === 'base' ? base : baseSepolia;

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(),
});

const paid = withPaymentInterceptor(
  axios.create({ baseURL, proxy: false }),
  walletClient
);

const mcpHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

const chainIdSchema = z.union([
  z.literal(1),
  z.literal('1'),
  z.literal(11155111),
  z.literal('11155111'),
  z.literal(8453),
  z.literal('8453'),
  z.literal(137),
  z.literal('137'),
]);

const valueSchema = z.union([
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative(),
]).default('0');

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

const transactionSchema = {
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Sender wallet address'),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Recipient wallet or contract address'),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/).default('0x').describe('Hex calldata'),
  value: valueSchema.describe('Native token amount in wei, preferably as a string'),
  chainId: chainIdSchema.describe('Simulation chain: 1 Ethereum, 11155111 Sepolia, 8453 Base, 137 Polygon; number or numeric string accepted'),
};

function normalizeTransaction(args) {
  return {
    ...args,
    value: String(args.value),
    chainId: Number(args.chainId),
  };
}

function formatError(error) {
  if (error.response) {
    const detail = typeof error.response.data === 'string'
      ? error.response.data
      : JSON.stringify(error.response.data);
    return `PreFlight HTTP ${error.response.status}: ${detail}`;
  }

  if (error.request) {
    return `PreFlight request failed: ${error.message}. Is PreFlight running at ${baseURL}?`;
  }

  return error.message;
}

async function callPaidPreflightTool(name, args) {
  try {
    const transaction = normalizeTransaction(args);
    const response = await paid.post('/mcp', rpc(1, 'tools/call', {
      name,
      arguments: transaction,
    }), { headers: mcpHeaders });

    const mcpMessage = parseMcpResponse(response.data);
    const result = parseToolTextJson(mcpMessage);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: formatError(error),
        },
      ],
      isError: true,
    };
  }
}

const server = new McpServer({
  name: 'preflight-paid-bridge',
  version: '1.0.0',
});

server.tool(
  'preflight_assess_paid',
  'Pay x402 and ask PreFlight to assess whether a blockchain transaction should proceed, review, or abort.',
  transactionSchema,
  async (args) => {
    return callPaidPreflightTool('preflight_assess', args);
  }
);

server.tool(
  'preflight_simulate_paid',
  'Pay x402 and ask PreFlight to simulate a blockchain transaction before broadcast.',
  transactionSchema,
  async (args) => {
    return callPaidPreflightTool('preflight_simulate', args);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
