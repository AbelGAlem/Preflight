const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { simulateTransaction } = require('../services/tenderly');
const { getNativePriceUSD } = require('../services/ethPrice');
const { PRICE_PER_REQUEST, PAYMENT_NETWORK } = require('../config');

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
      {
        from: z.string().describe('Wallet address initiating the transaction'),
        to: z.string().describe('Contract or wallet address receiving the transaction'),
        data: z.string().optional().default('0x').describe('ABI-encoded function call in hex'),
        value: z.string().optional().default('0').describe('Amount of ETH in wei'),
        chainId: z.number().int().positive().describe('Blockchain network (1=Ethereum, 8453=Base, 137=Polygon)'),
      },
      async ({ from, to, data, value, chainId }) => {
        try {
          const result = await simulateTransaction({ from, to, data, value, chainId });
          const gasCostNative = result.gasEstimate && result.effectiveGasPrice
            ? ((result.gasEstimate * result.effectiveGasPrice) / 1e18).toFixed(8)
            : null;

          const nativePrice = await getNativePriceUSD(result.nativeToken);
          const gasCostUSD = gasCostNative && nativePrice
            ? (parseFloat(gasCostNative) * nativePrice).toFixed(4)
            : null;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: result.success,
                  gasEstimate: result.gasEstimate,
                  nativeToken: result.nativeToken,
                  gasCostNative,
                  gasCostUSD,
                  logs: result.logs,
                  revertReason: result.revertReason,
                  simulatedAt: new Date().toISOString(),
                }, null, 2),
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

