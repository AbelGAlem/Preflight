const axios = require('axios');

const COINGECKO_IDS = {
  ETH: 'ethereum',
  MATIC: 'matic-network',
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
      { timeout: 5000 }
    );
    const price = data[id].usd;
    cache[id] = { price, expiresAt: now + CACHE_TTL_MS };
    return price;
  } catch (err) {
    console.warn(`[nativePrice] fetch failed for ${token}:`, err.message);
    return cache[id]?.price || null;
  }
}

module.exports = { getNativePriceUSD };
