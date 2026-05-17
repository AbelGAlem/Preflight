const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { simulateWithPricing, assessTransaction } = require('../services/preflight');
const { PRICE_PER_REQUEST, PAYMENT_NETWORK } = require('../config');

const transactionSchema = {
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid from address').describe('Wallet address initiating the transaction'),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid to address').describe('Contract or wallet address receiving the transaction'),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/, 'Invalid hex data').optional().default('0x').describe('ABI-encoded function call in hex'),
  value: z.string().regex(/^\d+$/, 'Value must be a non-negative integer string in wei').optional().default('0').describe('Amount of native token in wei'),
  chainId: z.union([z.literal(1), z.literal(8453), z.literal(137)]).describe('Blockchain network (1=Ethereum, 8453=Base, 137=Polygon)'),
};

function createMcpRouter() {
  const express = require('express');
  const router = express.Router();

  router.post('/', async (req, res) => {
    const server = new McpServer({
      name: 'preflight',
      version: '1.0.0',
    });

    server.tool(
      'preflight_simulate',
      `Simulate a blockchain transaction before sending it on-chain. Returns whether it will succeed, estimated gas cost in USD, emitted events, and revert reason if it would fail. Use this before submitting any transaction to avoid wasted gas fees. Paid tool: each call costs $${String(PRICE_PER_REQUEST).replace(/^\$/, '')} settled via x402 on ${PAYMENT_NETWORK}; the call returns HTTP 402 with payment requirements until a valid X-PAYMENT proof is supplied.`,
      transactionSchema,
      async ({ from, to, data, value, chainId }) => {
        try {
          const result = await simulateWithPricing({ from, to, data, value, chainId });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Simulation error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );

    server.tool(
      'preflight_assess',
      `Simulate a blockchain transaction and return an agent-friendly proceed/review/abort decision. Paid tool: each call costs $${String(PRICE_PER_REQUEST).replace(/^\$/, '')} settled via x402 on ${PAYMENT_NETWORK}; the call returns HTTP 402 with payment requirements until a valid X-PAYMENT proof is supplied.`,
      transactionSchema,
      async ({ from, to, data, value, chainId }) => {
        try {
          const result = await assessTransaction({ from, to, data, value, chainId });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Assessment error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => server.close());
  });

  router.get('/', async (req, res) => {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
  });

  return router;
}

module.exports = { createMcpRouter };

