import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';
import { OracleType, type OracleFeedConfig } from '../types/oracle.js';

const mockReadContract = vi.hoisted(() => vi.fn());

vi.mock('../utils/client.js', () => ({
  getPublicClient: vi.fn().mockReturnValue({
    readContract: mockReadContract,
  }),
}));

import { ChainlinkOracle, chainlinkOracle } from './providers/chainlink.js';

const feedConfig: OracleFeedConfig = {
  type: OracleType.CHAINLINK,
  chainId: 42161,
  address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' as Address,
  decimals: 8,
};

describe('ChainlinkOracle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has CHAINLINK type', () => {
    expect(chainlinkOracle.type).toBe(OracleType.CHAINLINK);
  });

  it('is an instance of ChainlinkOracle', () => {
    expect(chainlinkOracle).toBeInstanceOf(ChainlinkOracle);
  });

  describe('fetchPrice', () => {
    it('returns price data from Chainlink feed', async () => {
      const roundId = 100n;
      const answer = 200000000000n; // $2000.00000000
      const startedAt = 1700000000n;
      const updatedAt = 1700000100n;
      const answeredInRound = 100n;

      mockReadContract.mockResolvedValue([
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
      ]);

      const result = await chainlinkOracle.fetchPrice(feedConfig);

      expect(result.price).toBe(answer);
      expect(result.priceDecimals).toBe(8);
      expect(result.updatedAt).toBe(updatedAt);
      expect(result.source).toBe(OracleType.CHAINLINK);
    });

    it('calls readContract with correct parameters', async () => {
      mockReadContract.mockResolvedValue([
        100n,
        200000000000n,
        0n,
        1700000000n,
        100n,
      ]);

      await chainlinkOracle.fetchPrice(feedConfig);

      expect(mockReadContract).toHaveBeenCalledWith({
        address: feedConfig.address,
        abi: expect.any(Array),
        functionName: 'latestRoundData',
      });
    });

    it('throws when price is zero', async () => {
      mockReadContract.mockResolvedValue([100n, 0n, 0n, 1700000000n, 100n]);

      await expect(chainlinkOracle.fetchPrice(feedConfig)).rejects.toThrow(
        'invalid price'
      );
    });

    it('throws when price is negative', async () => {
      mockReadContract.mockResolvedValue([100n, -1n, 0n, 1700000000n, 100n]);

      await expect(chainlinkOracle.fetchPrice(feedConfig)).rejects.toThrow(
        'invalid price'
      );
    });

    it('uses feed decimals from config', async () => {
      const customConfig: OracleFeedConfig = {
        ...feedConfig,
        decimals: 18,
      };
      mockReadContract.mockResolvedValue([
        100n,
        1000000000000000000n,
        0n,
        1700000000n,
        100n,
      ]);

      const result = await chainlinkOracle.fetchPrice(customConfig);
      expect(result.priceDecimals).toBe(18);
    });

    it('propagates RPC errors', async () => {
      mockReadContract.mockRejectedValue(new Error('RPC timeout'));

      await expect(chainlinkOracle.fetchPrice(feedConfig)).rejects.toThrow(
        'RPC timeout'
      );
    });
  });
});
