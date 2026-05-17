const express = require('express');
const { z } = require('zod');
const { simulateTransaction } = require('../services/tenderly');

const router = express.Router();

const SimulateSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid from address'),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid to address'),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/, 'Invalid hex data').optional().default('0x'),
  value: z.string().regex(/^\d+$/, 'Value must be a non-negative integer string in wei').default('0'),
  chainId: z.union([z.literal(1), z.literal(8453), z.literal(137)]),
});

router.post('/', async (req, res) => {
  const parsed = SimulateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  try {
    const result = await simulateTransaction(parsed.data);

    const gasEstimateEth = result.gasEstimate
      ? (result.gasEstimate * 12e-9).toFixed(6)
      : null;

    res.json({
      success: result.success,
      gasEstimate: result.gasEstimate,
      gasCostETH: gasEstimateEth,
      gasCostUSD: null,
      logs: result.logs,
      revertReason: result.revertReason,
      simulatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({
      success: false,
      gasEstimate: null,
      gasCostETH: null,
      gasCostUSD: null,
      logs: [],
      revertReason: err.message,
      simulatedAt: new Date().toISOString(),
    });
  }
});

module.exports = router;
