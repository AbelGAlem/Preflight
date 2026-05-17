# PreFlight ✈️

**Simulate before you transact.** Dry-run any blockchain transaction and get back whether it will succeed, the gas cost in USD, the events it will emit, and the exact revert reason if it would fail — *before* you spend a cent of gas on-chain.

PreFlight is a **pay-per-use API**: no accounts, no API keys. Each paid call settles a ~$0.01 USDC micropayment via [x402](https://www.x402.org/) (HTTP 402 + on-chain settlement). It also exposes an **MCP server**, so autonomous AI agents can pay-per-call to sanity-check transactions before broadcasting them.

---

## Why

Every reverted transaction is wasted gas and a bad user/agent experience. Wallets and agents *should* dry-run first, but most don't because there's no frictionless, payable, agent-native way to do it. PreFlight is that: one HTTP call, one micropayment, instant verdict — and an MCP tool an agent can call autonomously.

## How it works

```
client / agent ──POST {from,to,data,value,chainId}──▶ PreFlight
                                                          │
                                              x402 payment (USDC on Base)
                                                          │
                                              Tenderly tenderly_simulateTransaction
                                                          │
                                              + live USD gas pricing (CoinGecko)
                                                          ▼
        { success, gasEstimate, gasCostNative, gasCostUSD, logs, revertReason }
```

Three surfaces, one simulation engine:

| Endpoint | Payment | Use |
|---|---|---|
| `POST /preview` | **Free** | Powers the web UI; quick testing |
| `POST /simulate` | **Paid** (x402) | Production REST integration |
| `POST /mcp` | **Paid** per `tools/call` | AI agents (`preflight_simulate` tool); discovery is free |

Supported chains: Ethereum (`1`), Base (`8453`), Polygon (`137`).

## Quick start

```bash
git clone https://github.com/AbelGAlem/Preflight
cd Preflight
npm install
cp .env.example .env      # then fill in TENDERLY_NODE_ACCESS_KEY + WALLET_ADDRESS
npm start                 # http://localhost:3000
```

Minimum required env to run the free path: `TENDERLY_NODE_ACCESS_KEY`. To enable paid routes, also set `WALLET_ADDRESS` and `PAYMENT_NETWORK`.

### Environment variables

```
TENDERLY_NODE_ACCESS_KEY=   # dashboard.tenderly.co → Node → key after the last slash of the HTTPS URL
WALLET_ADDRESS=             # Base wallet that RECEIVES x402 payments
PRICE_PER_REQUEST=0.01      # USD per paid call
PAYMENT_NETWORK=base-sepolia # base-sepolia for testing, base for production
PAYMENT_FACILITATOR_URL=    # optional; blank = x402 default facilitator
PORT=3000
NODE_ENV=development
```

For the paid smoke tests only, also set `PAYER_PRIVATE_KEY` to a **funded test wallet** key (Base Sepolia USDC) — never your receiving wallet's key.

## Demo

### 1. Web UI — no wallet, instant

```bash
npm start
```
Open <http://localhost:3000>, click **Load success example** (wraps 0.1 ETH → WETH) or **Load fail example** (bad selector on USDC), then **Simulate**. Green = will succeed (with USD gas cost); red = will revert (with reason). This uses the free `/preview` path.

### 2. Paid REST — the x402 money flow

Set `PAYER_PRIVATE_KEY` (funded Base Sepolia wallet) in `.env`, then:
```bash
npm run test:paid
```
You'll see: `402 → auto-pay → Payment accepted: true`, the on-chain settlement response, and the simulation result. A real micropayment just happened.

### 3. Paid MCP — an AI agent paying per call

```bash
node scripts/test-mcp-paid.mjs
```
The agent does free discovery (`initialize`, `tools/list`), then pays $0.01 on `tools/call preflight_simulate`. Point any MCP client (e.g. Claude Desktop) at `http://localhost:3000/mcp` for a live agent demo.

## API

### `POST /preview` · `POST /simulate`

Request:
```json
{
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "to":   "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "data": "0xa9059cbb...",
  "value": "0",
  "chainId": 1
}
```
`data` defaults to `0x`, `value` is a wei string defaulting to `0`. Bodies are validated with Zod (HTTP 400 on invalid input).

Response:
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
On a reverting tx: `success: false` and `revertReason` is populated. Upstream/service errors return HTTP 502 with the same shape; unpaid calls to `/simulate` return HTTP 402.

### `POST /mcp`

Standard MCP over Streamable HTTP. `initialize` and `tools/list` are free. The `preflight_simulate` tool takes the same arguments as above and is billed per `tools/call` via x402.

### `GET /health`

`{ "status": "ok", "version": "1.0.0" }`

`test.http` contains runnable examples for every endpoint (success, fail, validation error, and the full MCP handshake).

## Tech stack

Node + Express · [Tenderly](https://tenderly.co/) simulation RPC · [x402](https://www.x402.org/) (`x402-express` / `x402-axios`) for HTTP-native payments · [Model Context Protocol SDK](https://modelcontextprotocol.io/) · `viem` · Zod · CoinGecko (live USD gas pricing) · vanilla HTML/CSS/JS frontend · Railway deploy.

## Deployment

`railway.toml` is preconfigured (nixpacks, `npm start`, restart-on-failure). Push to Railway, set the env vars in the dashboard, and for production use `PAYMENT_NETWORK=base` and `NODE_ENV=production`.
