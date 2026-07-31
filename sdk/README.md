# @graviton/sdk

TypeScript SDK for cross-chain intent settlement via the Graviton protocol. Built following [viem](https://viem.sh)'s client-action architecture for type safety and tree-shakeability.

## Features

- **viem-style Architecture**: Familiar client-action pattern with full TypeScript support
- **Cross-chain Intents**: Execute tokens transfers and contract calls across chains
- **Merkle Tree Signing**: Efficient batching with one signature for multiple orders
- **Kernel Account Integration**: Seamless integration with ZeroDev's account abstraction
- **Transport Abstraction**: Custom JSON-RPC transport for Graviton API
- **Tree-shakeable**: Import only what you need

## Installation

```bash
pnpm install @graviton/sdk @zerodev/sdk viem
```

## Quick Start

```typescript
import {
  createInteropClient,
  graviton,
  installInteropExecutor,
  INTEROP_EXECUTOR,
} from '@graviton/sdk';
import { createKernelAccount, KERNEL_V3_3, getEntryPoint } from '@zerodev/sdk';
import { toMultiChainECDSAValidator } from '@zerodev/multi-chain-ecdsa-validator';
import { createPublicClient, http, parseUnits, encodeFunctionData, erc20Abi } from 'viem';
import { base, arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// 1. Set up public client and signer
const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

const signer = privateKeyToAccount(process.env.PRIVATE_KEY);

// 2. Create ECDSA validator
const ecdsaValidator = await toMultiChainECDSAValidator(publicClient, {
  signer,
  kernelVersion: KERNEL_V3_3,
  entryPoint: getEntryPoint('0.7'),
});

// 3. Create kernel account with interop executor
const kernelAccount = await createKernelAccount(publicClient, {
  plugins: { sudo: ecdsaValidator },
  kernelVersion: KERNEL_V3_3,
  entryPoint: getEntryPoint('0.7'),
  initConfig: [installInteropExecutor('v0.4')],
});

// 4. Create interop client
const client = createInteropClient({
  account: kernelAccount,
  chain: base,
  bundlerTransport: http(process.env.ZERODEV_RPC_URL),
  gravitonTransport: graviton({ url: process.env.GRAVITON_API_URL }),
  version: 'v0.4',
  gravitonUrl: process.env.GRAVITON_API_URL,
});

// 5. Prepare cross-chain order
const { orders } = await client.prepareOrders({
  sender: kernelAccount.address,
  initData: await kernelAccount.generateInitCode(),
  targetChainId: base.id,
  targetTokens: [
    {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      amount: parseUnits('10', 6),
    },
  ],
  targetCalls: [
    {
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: ['0xRecipient...', parseUnits('10', 6)],
      }),
      mode: '0x00000000000000000000000000000000000000000000000000000000000000000',
    },
  ],
  srcTokens: [
    {
      chainId: arbitrum.id,
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    },
  ],
});

// 6. Sign and submit orders
const { orderHashes, targetChainId } = await client.sendOrders({ orders });

console.log('Order submitted:', orderHashes[0].orderHash);

// 7. Wait for order to open (source chain)
const openReceipt = await client.waitForOrderOpenReceipt({
  orderHash: orderHashes[0].orderHash,
  chainId: Number(orderHashes[0].chainId),
  interopExecutor: INTEROP_EXECUTOR,
});

console.log('Order opened on source chain:', openReceipt);

// 8. Wait for order to fill (target chain)
const fillReceipt = await client.waitForOrderFillReceipt({
  orderHash: orderHashes[0].orderHash,
  chainId: Number(targetChainId),
  interopExecutor: INTEROP_EXECUTOR,
});

console.log('Order filled on target chain:', fillReceipt);
```

## API Reference

### Client

#### `createInteropClient(config)`

Creates an Interop Client for cross-chain intent settlement.

**Parameters:**

- `config.account`: Kernel smart account with interop executor installed
- `config.chain`: Blockchain network
- `config.bundlerTransport`: Transport for bundler operations
- `config.gravitonTransport`: Transport for Graviton API (use `graviton()`)
- `config.version`: Graviton protocol version (`'v0.4'`)
- `config.gravitonUrl`: Graviton API endpoint URL

**Returns:** `InteropClient` with extended actions

### Actions

#### `prepareOrders(parameters)`

Prepares cross-chain orders via the Graviton API.

**Parameters:**

- `sender`: Account address sending the orders
- `initData`: Initialization data for account deployment
- `targetChainId`: Target chain ID for order execution
- `targetTokens`: Array of tokens to receive on target chain
- `targetCalls`: Execution calls to make on target chain
- `srcTokens`: Source token candidates for payment

**Returns:** `{ orders: Order[] }`

#### `sendOrders(parameters)`

Signs and submits orders to the Graviton network.

**Parameters:**

- `orders`: Array of orders to sign and send

**Returns:** `{ orderHashes, targetChainId }`

#### `waitForOrderOpenReceipt(parameters)`

Waits for an order to be opened on the source chain.

**Parameters:**

- `orderHash`: The hash of the order to track
- `chainId`: Source chain ID where the order opens
- `interopExecutor`: Interop executor contract address
- `pollingInterval?`: Polling frequency in ms (default: 1000)
- `retryCount?`: Number of retry attempts (default: 6)
- `timeout?`: Timeout in ms (default: 120000)

**Returns:** Receipt information

#### `waitForOrderFillReceipt(parameters)`

Waits for an order to be filled on the target chain.

**Parameters:**

- `orderHash`: The hash of the order to track
- `chainId`: Target chain ID where the order fills
- `interopExecutor`: Interop executor contract address
- `pollingInterval?`: Polling frequency in ms (default: 1000)
- `retryCount?`: Number of retry attempts (default: 6)
- `timeout?`: Timeout in ms (default: 120000)

**Returns:** Receipt information

### Transports

#### `graviton(config)`

Creates a custom transport for the Graviton API.

**Parameters:**

- `url`: Graviton API URL endpoint
- `timeout?`: Request timeout in ms (default: 30000)
- `retryCount?`: Number of retry attempts (default: 3)
- `retryDelay?`: Base delay between retries in ms (default: 150)

**Returns:** Viem `Transport` instance

### Utilities

#### `installInteropExecutor(version)`

Generates initialization config for installing the Interop Executor module on a Kernel account.

**Parameters:**

- `version`: Interop protocol version (`'v0.4'`)

**Returns:** Hex-encoded function call data

#### `getOrderHash(order)`

Computes the keccak256 hash of an order.

**Parameters:**

- `order`: The order to hash

**Returns:** Order hash as `Hex`

### Constants

```typescript
export const INTEROP_EXECUTOR: Address; // 0xB197446a6C7223744fa1A64fdB1af840Dc1DBf62
export const BALANCE_VALIDATOR: Address; // 0x68748a3352ca79a488966D5277486AB7DF4D246E
export const CCTP_ADAPTER: Address; // 0x3D3b330D54698dcE317A42041F0512EA2d586757
export const ACROSS_ADAPTER: Address; // 0xd61AC38d0E4Af2C972087b4f5d86a751db4AeAeD
```

### Error Classes

```typescript
export class GravitonError extends Error;
export class WaitForOrderOpenReceiptTimeoutError extends GravitonError;
export class WaitForOrderFillReceiptTimeoutError extends GravitonError;
export class PrepareOrdersError extends GravitonError;
export class SendOrdersError extends GravitonError;
export class TransportError extends GravitonError;
```

## Architecture

The SDK follows viem's client-action architecture:

- **Clients**: Manage configuration and transport layers
- **Actions**: Standalone functions that operate on clients
- **Transports**: Abstract communication with different backends
- **Types**: Full TypeScript support with type inference

### Why This Architecture?

1. **Tree-shakeable**: Import only the actions you need
2. **Type-safe**: Full TypeScript inference throughout
3. **Testable**: Actions can be tested in isolation
4. **Familiar**: Same patterns as viem for easy adoption
5. **Extensible**: Easy to add custom actions

## How It Works

### Merkle Tree Signing

The SDK uses Merkle trees for efficient batch signing:

1. Hash each order individually
2. Build a Merkle tree from the hashes
3. Sign the Merkle root once
4. Include a Merkle proof with each order

This allows one signature to cover multiple orders, reducing gas costs and improving UX.

### Cross-chain Flow

1. **Prepare**: API optimizes routes and calculates fees
2. **Sign**: Orders are signed with Merkle tree batching
3. **Open**: Source chain transaction locks funds for bridging
4. **Bridge**: Funds are bridged via CCTP or Across
5. **Fill**: Target chain transaction delivers tokens and executes calls

## Contributing

Contributions are welcome! Please see the main [graviton-monorepo](https://github.com/graviton/graviton-monorepo) for contribution guidelines.

## License

MIT
