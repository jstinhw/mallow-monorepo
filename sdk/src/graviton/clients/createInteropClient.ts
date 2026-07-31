import { createClient, http } from 'viem';
import { GRAVITON_API_URL } from '../constants/index.js';
import { interopActions } from './decorators/interop.js';
import type { InteropClient, InteropClientConfig } from './types.js';

/**
 * Creates an Interop Client for cross-chain intent settlement via Graviton protocol.
 *
 * The Interop Client extends a standard viem client with specialized actions for:
 * - Preparing cross-chain orders
 * - Signing and submitting orders
 * - Waiting for order execution receipts
 *
 * @param config - Configuration for the Interop Client
 * @returns An Interop Client with extended actions
 *
 * @example
 * ```typescript
 * import { createInteropClient, installInteropExecutor } from '@graviton/sdk';
 * import { createKernelAccount } from '@zerodev/sdk';
 * import { base } from 'viem/chains';
 *
 * // 1. Create kernel account with interop executor
 * const kernelAccount = await createKernelAccount(publicClient, {
 *   plugins: { sudo: ecdsaValidator },
 *   kernelVersion: KERNEL_V3_3,
 *   entryPoint: getEntryPoint('0.7'),
 *   initConfig: [installInteropExecutor('v0.4')],
 * });
 *
 * // 2. Create interop client (uses default Graviton API URL)
 * const client = createInteropClient({
 *   account: kernelAccount,
 *   chain: base,
 *   version: 'v0.4',
 * });
 *
 * // 3. Use the client
 * const { orders } = await client.prepareOrders({ ... });
 * ```
 */
export function createInteropClient(config: InteropClientConfig): InteropClient {
  const { account, gravitonTransport = http(GRAVITON_API_URL), version } = config;

  // Create graviton client for API operations
  const gravitonClient = createClient({
    account,
    transport: gravitonTransport,
  });

  // Combine into InteropClient with additional properties
  const interopClient = Object.assign(gravitonClient, {
    gravitonClient,
    version,
  });

  // Extend client with interop actions
  // Note: Using type assertion due to viem's complex client types
  return interopClient.extend(interopActions as any) as any as InteropClient;
}
