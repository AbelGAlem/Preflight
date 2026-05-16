import 'dotenv/config';
import axios from 'axios';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { decodeXPaymentResponse, withPaymentInterceptor } from 'x402-axios';

const payerPrivateKey = process.env.PAYER_PRIVATE_KEY;
const paymentNetwork = process.env.PAYMENT_NETWORK || 'base-sepolia';
const baseURL = process.env.PREFLIGHT_URL || `http://localhost:${process.env.PORT || 3000}`;

if (!payerPrivateKey) {
  console.error('Missing PAYER_PRIVATE_KEY in your environment.');
  console.error('Use a funded test wallet private key, not your receiving WALLET_ADDRESS key.');
  process.exit(1);
}

if (!['base', 'base-sepolia'].includes(paymentNetwork)) {
  console.error(`Unsupported PAYMENT_NETWORK for this smoke test: ${paymentNetwork}`);
  process.exit(1);
}

const normalizedPrivateKey = payerPrivateKey.startsWith('0x')
  ? payerPrivateKey
  : `0x${payerPrivateKey}`;

if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
  console.error('PAYER_PRIVATE_KEY must be a 32-byte hex private key.');
  process.exit(1);
}

const account = privateKeyToAccount(normalizedPrivateKey);
const chain = paymentNetwork === 'base' ? base : baseSepolia;

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(),
});

const api = withPaymentInterceptor(axios.create({
  baseURL,
  proxy: false,
}), walletClient);

const payload = {
  from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  data: '0xa9059cbb000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9b0000000000000000000000000000000000000000000000000000000005f5e100',
  value: '0',
  chainId: 1,
};

try {
  console.log(`Paying ${baseURL}/simulate from ${account.address} on ${paymentNetwork}...`);

  const response = await api.post('/simulate', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  const paymentResponseHeader = response.headers['x-payment-response'];
  const paymentResponse = paymentResponseHeader
    ? decodeXPaymentResponse(paymentResponseHeader)
    : null;

  console.log('Payment accepted:', Boolean(paymentResponseHeader));
  if (paymentResponse) {
    console.log('Payment response:', JSON.stringify(paymentResponse, null, 2));
  }

  console.log('Simulation response:', JSON.stringify(response.data, null, 2));
} catch (error) {
  if (error.response) {
    console.error(`Request failed with HTTP ${error.response.status}`);
    console.error(JSON.stringify(error.response.data, null, 2));

    if (error.response.status === 402 && error.response.data?.error?.includes('insufficient_balance')) {
      const [requirement] = error.response.data.accepts || [];
      if (requirement) {
        console.error(`Fund ${error.response.data.payer} with at least ${Number(requirement.maxAmountRequired) / 1e6} USDC on ${requirement.network}.`);
        console.error(`USDC token: ${requirement.asset}`);
      }
    }
  } else {
    console.error(error.message);
  }
  process.exit(1);
}
