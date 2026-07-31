import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';
import {
  OracleType,
  type OracleProvider,
  type OracleFeedConfig,
  type PriceData,
} from '../types/oracle.js';

vi.mock('./providers/chainlink.js', () => ({
  chainlinkOracle: {
    type: OracleType.CHAINLINK,
    fetchPrice: vi.fn(),
  },
}));

import { oracleRegistry } from './index.js';
import { chainlinkOracle } from './providers/chainlink.js';

const mockChainlinkFetch = chainlinkOracle.fetchPrice as ReturnType<
  typeof vi.fn
>;

const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address;
const ETH_NATIVE = '0x0000000000000000000000000000000000000000' as Address;

function makePriceData(
  price: bigint,
  source: OracleType = OracleType.CHAINLINK
): PriceData {
  return {
    price,
    priceDecimals: 8,
    updatedAt: BigInt(Math.floor(Date.now() / 1000)),
    source,
  };
}

describe('OracleRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('provider management', () => {
    it('has chainlink registered by default', () => {
      expect(oracleRegistry.has(OracleType.CHAINLINK)).toBe(true);
    });

    it('returns registered provider', () => {
      const provider = oracleRegistry.get(OracleType.CHAINLINK);
      expect(provider).toBeDefined();
      expect(provider!.type).toBe(OracleType.CHAINLINK);
    });

    it('returns undefined for unregistered provider', () => {
      expect(oracleRegistry.get(OracleType.PYTH)).toBeUndefined();
    });

    it('reports unregistered type correctly', () => {
      expect(oracleRegistry.has(OracleType.PYTH)).toBe(false);
      expect(oracleRegistry.has(OracleType.REDSTONE)).toBe(false);
    });

    it('allows registering new providers', () => {
      const mockProvider: OracleProvider = {
        type: OracleType.PYTH,
        fetchPrice: vi.fn(),
      };
      oracleRegistry.register(mockProvider);
      expect(oracleRegistry.has(OracleType.PYTH)).toBe(true);
      expect(oracleRegistry.get(OracleType.PYTH)).toBe(mockProvider);
    });
  });

  describe('fetchFromOracle', () => {
    it('fetches price from the correct provider', async () => {
      const feedConfig: OracleFeedConfig = {
        type: OracleType.CHAINLINK,
        chainId: 42161,
        address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
        decimals: 8,
      };
      mockChainlinkFetch.mockResolvedValue(makePriceData(200000000000n));

      const result = await oracleRegistry.fetchFromOracle(feedConfig);
      expect(result.price).toBe(200000000000n);
      expect(mockChainlinkFetch).toHaveBeenCalledWith(feedConfig);
    });

    it('throws for unknown oracle type', async () => {
      const feedConfig: OracleFeedConfig = {
        type: OracleType.REDSTONE,
        chainId: 42161,
        address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
        decimals: 8,
      };

      await expect(oracleRegistry.fetchFromOracle(feedConfig)).rejects.toThrow(
        'Unknown oracle type'
      );
    });
  });

  describe('fetchPriceFromOracles', () => {
    it('fetches from single oracle', async () => {
      const oracles: OracleFeedConfig[] = [
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
          decimals: 8,
        },
      ];
      mockChainlinkFetch.mockResolvedValue(makePriceData(100000000n));

      const result = await oracleRegistry.fetchPriceFromOracles(oracles);
      expect(result.price).toBe(100000000n);
    });

    it('throws for empty oracles array', async () => {
      await expect(oracleRegistry.fetchPriceFromOracles([])).rejects.toThrow(
        'No oracle feeds configured'
      );
    });

    it('returns first successful result from multiple oracles', async () => {
      const oracles: OracleFeedConfig[] = [
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
          decimals: 8,
        },
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3' as Address,
          decimals: 8,
        },
      ];
      mockChainlinkFetch.mockResolvedValue(makePriceData(200000000000n));

      const result = await oracleRegistry.fetchPriceFromOracles(oracles);
      expect(result.price).toBe(200000000000n);
    });

    it('succeeds if at least one oracle succeeds (Promise.any)', async () => {
      const oracles: OracleFeedConfig[] = [
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
          decimals: 8,
        },
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3' as Address,
          decimals: 8,
        },
      ];
      mockChainlinkFetch
        .mockRejectedValueOnce(new Error('Feed 1 failed'))
        .mockResolvedValueOnce(makePriceData(100000000n));

      const result = await oracleRegistry.fetchPriceFromOracles(oracles);
      expect(result.price).toBe(100000000n);
    });

    it('throws AggregateError message when all oracles fail', async () => {
      const oracles: OracleFeedConfig[] = [
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
          decimals: 8,
        },
        {
          type: OracleType.CHAINLINK,
          chainId: 42161,
          address: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3' as Address,
          decimals: 8,
        },
      ];
      mockChainlinkFetch
        .mockRejectedValueOnce(new Error('Feed 1 failed'))
        .mockRejectedValueOnce(new Error('Feed 2 failed'));

      await expect(
        oracleRegistry.fetchPriceFromOracles(oracles)
      ).rejects.toThrow('All oracles failed');
    });
  });

  describe('fetchPrice', () => {
    it('fetches price for a known token on a supported chain', async () => {
      mockChainlinkFetch.mockResolvedValue(makePriceData(100000000n));

      const result = await oracleRegistry.fetchPrice(42161, ARB_USDC);
      expect(result.price).toBe(100000000n);
    });

    it('fetches price for native ETH', async () => {
      mockChainlinkFetch.mockResolvedValue(makePriceData(200000000000n));

      const result = await oracleRegistry.fetchPrice(42161, ETH_NATIVE);
      expect(result.price).toBe(200000000000n);
    });

    it('throws for unknown token address', async () => {
      const unknownToken =
        '0x1234567890abcdef1234567890abcdef12345678' as Address;
      await expect(
        oracleRegistry.fetchPrice(42161, unknownToken)
      ).rejects.toThrow('not found on chain');
    });
  });
});
