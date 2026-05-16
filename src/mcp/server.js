const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { simulateTransaction } = require('../services/tenderly');

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
      'Simulate a blockchain transaction before sending it on-chain. Returns whether it will succeed, estimated gas cost in USD, emitted events, and revert reason if it would fail. Use this before submitting any transaction to avoid wasted gas fees.',
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
          const gasEstimateEth = result.gasEstimate
            ? (result.gasEstimate * 12e-9).toFixed(6)
            : null;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: result.success,
                  gasEstimate: result.gasEstimate,
                  gasCostETH: gasEstimateEth,
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

