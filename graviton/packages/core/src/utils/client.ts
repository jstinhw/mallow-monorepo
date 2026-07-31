import { createPublicClient, http } from 'viem';
import type { PublicClient } from 'viem';
import { getChain, getRpcUrl } from '../constants/chains.js';

const clients = new Map<bigint, PublicClient>();

/**
 * Get a configured public client for the specified chain.
 * Clients are cached by chainId — subsequent calls return the same instance.
 */
export function getPublicClient(chainId: number | bigint): PublicClient {
  const key = BigInt(chainId);
  const existing = clients.get(key);
  if (existing) return existing;

  const chain = getChain(chainId);
  const rpcUrl = getRpcUrl(chainId);
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  clients.set(key, client);
  return client;
}
