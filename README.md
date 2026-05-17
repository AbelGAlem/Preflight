# PreFlight

Simulate before you transact. PreFlight dry-runs blockchain transactions before they are broadcast and returns either a raw simulation result or an agent-friendly proceed/review/abort assessment.

PreFlight is pay-per-use for production paths: paid REST and paid MCP tool calls settle a small USDC payment through x402. The free `/preview` path exists for the web UI and local smoke testing.

## Surfaces

| Surface | Payment | Purpose |
| --- | --- | --- |
| `GET /health` | Free | Health check |
| `POST /preview` | Free | UI/local preview path |
| `POST /simulate` | x402 paid | REST simulation API |
| `POST /mcp` `initialize` / `tools/list` | Free | MCP discovery |
| `POST /mcp` `tools/call preflight_simulate` | x402 paid | Agent simulation tool |
| `POST /mcp` `tools/call preflight_assess` | x402 paid | Agent decision tool |

Supported transaction simulation chains:

- Ethereum mainnet: `chainId` `1`
- Ethereum Sepolia: `chainId` `11155111`
- Base mainnet: `chainId` `8453`
- Polygon: `chainId` `137`

## Limitations

- PreFlight simulates transactions; it does not broadcast them.
- x402 payment can run on Base Sepolia for testing. Transaction simulation supports Ethereum mainnet, Ethereum Sepolia, Base mainnet, and Polygon.
- USD gas cost is estimated from CoinGecko when available and falls back to approximate prices if unavailable.
- The `preflight_assess` decision is rule-based. It is a safety pre-check, not a full contract audit.

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Minimum free-preview config:

```env
TENDERLY_NODE_ACCESS_KEY=
PORT=3000
NODE_ENV=development
```

Paid x402 config:

```env
WALLET_ADDRESS=             # receiving wallet
PRICE_PER_REQUEST=0.01
PAYMENT_NETWORK=base-sepolia
PAYMENT_FACILITATOR_URL=    # optional; blank uses package default
```

Paid smoke-test config:

```env
PAYER_PRIVATE_KEY=          # funded test wallet private key; never use a main wallet
PREFLIGHT_URL=http://localhost:3000
```

For Base Sepolia x402 tests, the payer needs test USDC and gas on Base Sepolia.

## Response Shapes

### `POST /preview` and `POST /simulate`

Request:

```json
{
  "from": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "data": "0x",
  "value": "0",
  "chainId": 1
}
```

Response:

```json
{
  "success": true,
  "gasEstimate": 21000,
  "nativeToken": "ETH",
  "gasCostNative": "0.00042000",
  "gasCostUSD": "1.0000",
  "logs": [],
  "revertReason": null,
  "simulatedAt": "2026-05-17T00:00:00.000Z"
}
```

### Example: Sepolia wallet-to-wallet transfer

```json
{
  "from": "0x1ad4C9d7CEa32B44cd54260A52C57B6Ce4e0D6eB",
  "to": "0x8E159C52Dc2823cB6728E26898A2bABC286BBAc7",
  "data": "0x",
  "value": "1000000000000000",
  "chainId": 11155111
}
```

This simulates a native Sepolia ETH transfer of `0.001 ETH`. It does not broadcast the transfer.

Validation errors return `400` on `/preview`. Unpaid `/simulate` returns `402` before validation.

### MCP `preflight_simulate`

Takes the same transaction arguments and returns the same simulation object as text content in the MCP tool result. It is paid only when called through `tools/call`; `initialize` and `tools/list` are free.

### MCP `preflight_assess`

Takes the same transaction arguments and returns:

```json
{
  "decision": "proceed",
  "riskLevel": "low",
  "reason": "The transaction simulation succeeded and the estimated cost is within the review thresholds.",
  "recommendation": "Proceed if the transaction intent and recipient are correct.",
  "simulation": {
    "success": true,
    "gasEstimate": 21000,
    "nativeToken": "ETH",
    "gasCostNative": "0.00042000",
    "gasCostUSD": "1.0000",
    "logs": [],
    "revertReason": null,
    "simulatedAt": "2026-05-17T00:00:00.000Z"
  }
}
```

Assessment rules:

- Failed simulation: `decision="abort"`, `riskLevel="high"`
- Missing `gasEstimate`: `decision="review"`, `riskLevel="medium"`
- `gasEstimate > 500000`: `decision="review"`, `riskLevel="medium"`
- `gasCostUSD > 10`: `decision="review"`, `riskLevel="medium"`
- Otherwise: `decision="proceed"`, `riskLevel="low"`

## Testing

Run syntax checks:

```bash
node --check src/services/preflight.js
node --check src/routes/simulate.js
node --check src/mcp/server.js
node --check src/middleware/payment.js
```

Run deterministic assessment-rule tests:

```bash
npm run test:rules
```

Run paid REST smoke test:

```bash
npm run test:paid
```

Run paid MCP assessment smoke test:

```bash
npm run test:mcp:simulate
npm run test:mcp:assess
```

`test.http` contains manual cases for:

- `GET /health`
- Free `/preview` success/fail
- Free `/preview` validation failures
- Unpaid `/simulate` returning `402`
- Free MCP `initialize`
- Free MCP `tools/list`
- Unpaid MCP `preflight_simulate` returning `402`
- Unpaid MCP `preflight_assess` returning `402`

## Claude Desktop MCP demo

PreFlight's hosted `/mcp` endpoint is x402-paid. Claude Desktop does not pay x402 directly, so the demo uses a local MCP stdio bridge that pays the x402 challenge and forwards results back to Claude.

Architecture:

```text
Claude Desktop -> local MCP bridge -> x402-paid PreFlight /mcp -> Tenderly
```

Start PreFlight:

```bash
npm start
```

Validate the paid MCP path:

```bash
npm run test:mcp:assess
```

Add this to Claude Desktop config:

```json
{
  "mcpServers": {
    "preflight": {
      "command": "node",
      "args": [
        "D:\\br br patapim\\Preflight\\scripts\\claude-preflight-bridge.mjs"
      ],
      "cwd": "D:\\br br patapim\\Preflight"
    }
  }
}
```

Restart Claude Desktop after editing the config.

Example Claude prompt:

```text
Use PreFlight to assess this transaction before broadcast:

from: 0x1ad4C9d7CEa32B44cd54260A52C57B6Ce4e0D6eB
to: 0x8E159C52Dc2823cB6728E26898A2bABC286BBAc7
data: 0x
value: 1000000000000000
chainId: 11155111

Tell me whether I should proceed, review, or abort.
```

Important: Claude is not paying x402 directly. The local MCP bridge pays using the configured test wallet.

## Architecture

```text
src/
  index.js                 Express app and route mounting
  config.js                Environment configuration
  routes/simulate.js       REST preview/simulate route handler
  services/tenderly.js     Tenderly RPC integration
  services/ethPrice.js     Native token USD pricing
  services/preflight.js    Shared pricing and assessment logic
  middleware/payment.js    x402 payment gating for paid REST/MCP calls
  mcp/server.js            MCP tools
public/index.html          Vanilla web UI
scripts/                   Paid and deterministic smoke tests
```

## Deployment

`railway.toml` is configured for Railway. Set the environment variables in Railway, use `PAYMENT_NETWORK=base` for production, and keep test private keys out of production environments.
