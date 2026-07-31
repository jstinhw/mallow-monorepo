import { http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createLogger,
  getPublicClient,
  getChain,
  getBundlerRpcUrl,
} from '@graviton/core';
import {
  createKernelAccount,
  createKernelAccountClient,
  type KernelAccountClient,
} from '@zerodev/sdk';
import { KERNEL_V3_3, getEntryPoint } from '@zerodev/sdk/constants';
import { config } from '../config/index.js';

const logger = createLogger('kernel-service', config.log.level);

/**
 * Kernel version constant
 */
const KERNEL_VERSION = KERNEL_V3_3;

/**
 * Entry point version constant
 */
const ENTRY_POINT = getEntryPoint('0.7');

/**
 * Create a kernel account client for cross-chain transactions
 * This service creates EIP-7702 compliant kernel accounts for batched operations
 *
 * @param chainId - The target chain ID
 * @param privateKey - The relayer's private key
 * @returns KernelAccountClient for executing transactions
 */
export async function getRelayerClient(
  chainId: number | bigint,
  privateKey: Hex = config.blockchain.relayerPrivateKey as Hex
): Promise<{ kernelClient: KernelAccountClient }> {
  logger.info({ chainId }, 'Creating relayer client for target chain');

  // Get chain configuration and RPC URLs
  const chain = getChain(chainId);
  const bundlerRpc = getBundlerRpcUrl(chainId);
  const publicClient = getPublicClient(chainId);

  // Create EIP-7702 account from private key
  const eip7702Account = privateKeyToAccount(privateKey);

  // Create kernel account with EIP-7702 support
  const account = await createKernelAccount(publicClient, {
    eip7702Account,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });

  // Create kernel account client with bundler support
  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc),
    client: publicClient,
  });

  logger.info(
    { chainId, address: account.address },
    'Kernel client created successfully'
  );

  return { kernelClient };
}
