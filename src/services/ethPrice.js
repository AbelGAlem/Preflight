const axios = require('axios');
const { COINGECKO_API_KEY } = require('../config');

const COINGECKO_IDS = {
  ETH: 'ethereum',
  MATIC: 'matic-network',
};

// Last-resort approximate USD prices, used only when the price API is
// unreachable (CoinGecko rate-limits datacenter IPs without an API key)
// and we have no cached value. A rough estimate beats returning null on a
// paid response. Set COINGECKO_API_KEY to get accurate live prices.
const FALLBACK_USD = {
  ethereum: 2200,
  'matic-network': 0.5,
};

const cache = {};
const CACHE_TTL_MS = 60_000;

async function getNativePriceUSD(token = 'ETH') {
  const id = COINGECKO_IDS[token] || 'ethereum';
  const now = Date.now();

  if (cache[id] && now < cache[id].expiresAt) {
    return cache[id].price;
  }

  try {
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
      {
        timeout: 5000,
        headers: COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {},
      }
    );
    const price = data?.[id]?.usd;
    if (typeof price !== 'number') {
      throw new Error(`Unexpected price response: ${JSON.stringify(data)}`);
    }
    cache[id] = { price, expiresAt: now + CACHE_TTL_MS };
    return price;
  } catch (err) {
    console.warn(`[nativePrice] fetch failed for ${token}:`, err.message);
    return cache[id]?.price ?? FALLBACK_USD[id] ?? null;
  }
}

module.exports = { getNativePriceUSD };
