# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

PreFlight is a pay-per-use blockchain transaction simulation API. Clients POST a transaction, we simulate it via Tenderly and return success/failure, gas cost (native + USD), emitted events, and revert reason. Paid requests are enforced via x402 (per-request USDC micropayment, Base Sepolia by default). AI agents connect via MCP at `/mcp`, where the simulation tool is also paid per call.

## Commands

```bash
npm install              # install dependencies
npm start                # start server (src/index.js)
npm run dev              # start with nodemon
npm run test:paid        # x402 smoke test against POST /simulate (needs PAYER_PRIVATE_KEY)
node scripts/test-mcp-paid.mjs   # x402 smoke test against the paid MCP tools/call
```

Quick free test (no payment — `/preview` mirrors `/simulate`):
```bash
curl -X POST http://localhost:3000/preview \
  -H "Content-Type: application/json" \
  -d '{"from":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","to":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","data":"0xd0e30db0","value":"100000000000000000","chainId":1}'
```

`test.http` has ready-made requests for every endpoint (REST + MCP).

## Architecture

```
src/
  index.js          # Express app: mounts /health, /preview (free), payment middleware, /simulate (paid), /mcp
  config.js         # Single source for all env vars — always import from here
  routes/
    simulate.js     # Shared router for /preview AND /simulate: Zod validation → tenderly → add native/USD gas cost
  services/
    tenderly.js     # All Tenderly RPC logic lives here and nowhere else
    ethPrice.js     # CoinGecko native-token USD price, 60s in-memory cache
  middleware/
    payment.js      # x402-express middleware — gates POST /simulate and the paid MCP tools/call
  mcp/
    server.js       # MCP server exposing the preflight_simulate tool, reuses tenderly + ethPrice
public/
  index.html        # Single-file vanilla HTML/CSS/JS UI — no frameworks, calls /preview
scripts/
  test-paid.mjs       # x402-axios: 402 → auto-pay → result against /simulate
  test-mcp-paid.mjs   # x402-axios: free discovery, then paid tools/call against /mcp
```

**Endpoints:**
- `GET /health` → `{ status: 'ok', version: '1.0.0' }`
- `POST /preview` — **free**, mounted *before* the payment middleware. Same logic and response shape as `/simulate`. The frontend uses this.
- `POST /simulate` — **paid** via x402.
- `POST /mcp` — MCP server. `initialize` and `tools/list` are free; `tools/call` for `preflight_simulate` is **paid**. `GET /mcp` → 405.

**Request flow (paid REST):** `POST /simulate` → x402 payment middleware → Zod validation → `tenderly.simulateTransaction()` → native + USD gas cost via `ethPrice` → formatted response.

**Free flow:** `POST /preview` → Zod validation → same as above, no payment.

**MCP:** Server mounts at `/mcp` on the same Express instance. The `preflight_simulate` tool accepts `{from, to, data, value, chainId}` and delegates to the same Tenderly + ethPrice services — no duplicated logic. The payment middleware inspects the JSON-RPC body and only bills `tools/call` for `preflight_simulate`, so agent handshakes stay free.

**Response shape (`/preview`, `/simulate`, and the MCP tool):**
```json
{
  "success": true,
  "gasEstimate": 51000,
  "nativeToken": "ETH",
  "gasCostNative": "0.00010200",
  "gasCostUSD": "0.3400",
  "logs": [{ "address": "0x…", "topics": ["0x…"], "data": "0x…" }],
  "revertReason": null,
  "simulatedAt": "2026-05-17T12:00:00.000Z"
}
```
On failure, `success` is `false` and `revertReason` holds the reason. Service errors return HTTP 502 with the same shape; invalid bodies return HTTP 400 with `{ error }`.

## Key Rules

- Import all env vars from `src/config.js`, never `process.env` directly.
- Validate all incoming request bodies with Zod before passing to services.
- Keep all Tenderly API logic inside `src/services/tenderly.js`.
- Never return raw Tenderly errors to the client — always format them.
- The frontend stays a single vanilla HTML file (`public/index.html`).
- Every route must have `try/catch` error handling.
- `/preview` must stay free: keep it mounted **before** `app.use(payment)` in `index.js`.
- The payment middleware gates both `POST /simulate` and the paid MCP `tools/call` — keep MCP discovery (`initialize`, `tools/list`) free.

## Tenderly RPC Integration

URL pattern: `https://{network}.gateway.tenderly.co/${TENDERLY_NODE_ACCESS_KEY}`

Supported `chainId` → network prefix → native token:
- `1` → `mainnet` → ETH
- `8453` → `base` → ETH
- `137` → `polygon` → MATIC

Method: `tenderly_simulateTransaction`. Critical field rules:
- `gas` and `value` must be **hex strings** (`gas` is hardcoded `"0x7a1200"` ≈ 8M; `value` is converted via `toHex`).
- Calldata field is `data` (not `input`); defaults to `"0x"`.
- Always pass `"latest"` as the second param.

Response extraction (in `tenderly.js`):
- `result.status`: success if `true`, `"0x1"`, or `1`.
- `result.gasUsed`: hex → decimal.
- `result.effectiveGasPrice`: hex → decimal; falls back to a per-chain default (20 gwei mainnet, 0.005 gwei Base, 50 gwei Polygon) if absent.
- Revert reason pulled from `result.error.message` / `result.error.data.message` / `result.revertReason` / `result.errorMessage`.
- `result.logs`: emitted events array, mapped to `{ address, topics, data }`.

USD conversion happens in the route/MCP layer: `gasEstimate * effectiveGasPrice / 1e18` → native, then × CoinGecko price (`ethPrice.js`, cached 60s; falls back to last cached price or `null` on failure).

## x402 Payment Flow

1. Client calls a paid route (`POST /simulate`, or MCP `tools/call preflight_simulate`) with no payment → server returns HTTP 402 with payment requirements.
2. Client pays `PRICE_PER_REQUEST` USDC on `PAYMENT_NETWORK` and retries with an `X-PAYMENT` header.
3. `x402-express` middleware verifies the proof against the facilitator; the request proceeds.

Config validation at startup (`payment.js`): `WALLET_ADDRESS` must be a valid EVM address, `PAYMENT_NETWORK` must be `base` or `base-sepolia`, `PRICE_PER_REQUEST` must be a positive USD amount. If misconfigured, paid routes return HTTP 503 (free `/preview` still works). A non-base64 `X-PAYMENT` header is rejected with HTTP 400 before reaching the facilitator.

## Environment Variables

```
TENDERLY_NODE_ACCESS_KEY=   # dashboard.tenderly.co → Node → key after last slash of HTTPS URL
WALLET_ADDRESS=             # Base wallet that RECEIVES x402 payments
PRICE_PER_REQUEST=0.01      # USD per paid call
PAYMENT_NETWORK=base-sepolia # base-sepolia for testing, base for production
PAYMENT_FACILITATOR_URL=    # optional; blank = x402-express default facilitator
COINGECKO_API_KEY=          # optional CoinGecko demo key; required for accurate gasCostUSD from cloud IPs (Railway)
PORT=3000
NODE_ENV=development
```

Test scripts only (not used by the server): `PAYER_PRIVATE_KEY` — a funded test wallet's key used to *send* payments in the smoke tests. Never the same as the receiving `WALLET_ADDRESS` key. Optional: `PREFLIGHT_URL` to point the scripts at a deployed instance.

## Deployment

`railway.toml` deploys to Railway via nixpacks, `npm start`, restart-on-failure. Set all env vars in the Railway dashboard. For production, set `PAYMENT_NETWORK=base` and `NODE_ENV=production`.

## Build Status

Built in phases (see git history): Core Server + Tenderly → x402 Payments → MCP Server → Frontend UI → Railway deploy. All phases are implemented; MCP was later changed from free to paid.
