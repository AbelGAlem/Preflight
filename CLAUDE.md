# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

PreFlight is a pay-per-use blockchain transaction simulation API. Clients POST a transaction, we simulate it via Tenderly and return success/failure, gas cost, emitted events, and revert reason. Payment is enforced via x402 (per-request micropayment on Base). AI agents connect via MCP at `/mcp`.

## Commands

```bash
npm install          # install dependencies
npm start            # start server (src/index.js)
npm run dev          # start with nodemon (if configured)
```

Test with curl (no payment middleware in Phase 1):
```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"from":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","to":"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48","data":"0xa9059cbb000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b0000000000000000000000000000000000000000000000000000000005f5e100","value":"0","chainId":1}'
```

## Architecture

```
src/
  index.js          # Express app: mounts routes, static files, MCP server
  config.js         # Single source for all env vars — always import from here
  routes/
    simulate.js     # POST /simulate — validates with Zod, calls tenderly service
  services/
    tenderly.js     # All Tenderly RPC logic lives here and nowhere else
  middleware/
    payment.js      # x402-express middleware — applied only to POST /simulate
  mcp/
    server.js       # MCP server exposing preflight_simulate tool, reuses tenderly service
public/
  index.html        # Single-file vanilla HTML/CSS/JS UI — no frameworks
```

**Request flow:** `POST /simulate` → x402 payment middleware → Zod validation → `tenderly.simulateTransaction()` → formatted response.

**MCP:** Server mounts at `/mcp` on the same Express instance. The `preflight_simulate` tool accepts `{from, to, data, value, chainId}` and delegates to the same Tenderly service — no duplicated logic.

## Key Rules

- Import all env vars from `src/config.js`, never `process.env` directly.
- Validate all incoming request bodies with Zod before passing to services.
- Keep all Tenderly API logic inside `src/services/tenderly.js`.
- Never return raw Tenderly errors to the client — always format them.
- The frontend stays a single vanilla HTML file (`public/index.html`).
- Every route must have `try/catch` error handling.

## Tenderly RPC Integration

URL pattern: `https://{network}.gateway.tenderly.co/${TENDERLY_NODE_ACCESS_KEY}`

Supported `chainId` → network prefix: `1` → `mainnet`, `8453` → `base`, `137` → `polygon`.

Method: `tenderly_simulateTransaction`. Critical field rules:
- `gas` and `value` must be **hex strings** (e.g. `"0x0"`, `"0x7a1200"` for 8M gas default).
- Calldata field is `data` (not `input`).
- Always pass `"latest"` as the second param.

Response extraction:
- `result.status`: `"0x1"` = success, `"0x0"` = failure.
- `result.gasUsed`: hex → convert to decimal.
- `result.error.message`: revert reason on failure.
- `result.logs`: emitted events array.

## x402 Payment Flow

1. Client calls `POST /simulate` with no payment → server returns HTTP 402.
2. Client pays ~$0.01 USDC on Base and retries with `X-PAYMENT` header.
3. `x402-express` middleware verifies proof, request proceeds.

Configured via `WALLET_ADDRESS` and `PRICE_PER_REQUEST` env vars.

Implementation notes:
- `src/middleware/payment.js` gates only `POST /simulate`; health, static UI, `/payment`, and `/mcp` remain free.
- The app returns `503` from `POST /simulate` if payment env vars are missing or invalid, instead of silently serving paid simulations for free.
- `GET /payment` exposes non-secret payment metadata for the UI and smoke tests.

## Environment Variables

```
TENDERLY_NODE_ACCESS_KEY=   # from dashboard.tenderly.co → Node → copy key after last slash
WALLET_ADDRESS=             # Base wallet to receive payments
PRICE_PER_REQUEST=0.01
PAYMENT_NETWORK=base-sepolia
PAYMENT_FACILITATOR_URL=   # optional facilitator override
PORT=3000
NODE_ENV=development
```

## Build Phases

The PRD (`prd.md`) defines 5 phases: Core Server + Tenderly → x402 Payments → MCP Server → Frontend UI → Deploy to Railway.
