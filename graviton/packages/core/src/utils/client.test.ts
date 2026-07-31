import { describe, it, expect, vi } from 'vitest';
import { mainnet } from 'viem/chains';

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({ mock: true }),
    http: vi.fn().mockReturnValue('mock-transport'),
  };
});

import { getPublicClient } from './client.js';
import { createPublicClient, http } from 'viem';

describe('getPublicClient', () => {
  it('returns a public client for valid chain', () => {
    const client = getPublicClient(1);
    expect(client).toBeDefined();
  });

  it('calls createPublicClient with correct chain and transport', () => {
    getPublicClient(1);
    expect(createPublicClient).toHaveBeenCalledWith({
      chain: mainnet,
      transport: 'mock-transport',
    });
  });

  it('calls http with the RPC URL', () => {
    getPublicClient(42161);
    expect(http).toHaveBeenCalled();
    const url = (http as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(url).toContain('arb-mainnet');
    expect(url).toContain('alchemy.com');
  });

  it('throws for unsupported chain', () => {
    expect(() => getPublicClient(56)).toThrow('Unsupported chain ID');
  });

  it('handles bigint chain ID', () => {
    getPublicClient(8453n);
    expect(createPublicClient).toHaveBeenCalled();
  });
});
