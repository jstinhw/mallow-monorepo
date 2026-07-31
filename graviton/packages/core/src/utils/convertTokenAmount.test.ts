import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';
import { OracleType, type PriceData } from '../types/oracle.js';

vi.mock('../oracles/index.js', () => ({
  oracleRegistry: {
    fetchPrice: vi.fn(),
  },
}));

import { convertTokenAmount } from './convertTokenAmount.js';
import { oracleRegistry } from '../oracles/index.js';

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const USDC_ADDRESS = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address;

const mockFetchPrice = oracleRegistry.fetchPrice as ReturnType<typeof vi.fn>;

function makePriceData(price: bigint, decimals = 8): PriceData {
  return {
    price,
    priceDecimals: decimals,
    updatedAt: BigInt(Math.floor(Date.now() / 1000)),
    source: OracleType.CHAINLINK,
  };
}

describe('convertTokenAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns same amount when tokenIn equals tokenOut', async () => {
    const result = await convertTokenAmount(
      42161,
      USDC_ADDRESS,
      USDC_ADDRESS,
      1000000n
    );
    expect(result).toBe(1000000n);
    expect(mockFetchPrice).not.toHaveBeenCalled();
  });

  it('converts ETH to USDC correctly', async () => {
    // ETH price: $2000 (200000000000 with 8 decimals)
    // USDC price: $1 (100000000 with 8 decimals)
    // 1 ETH (1e18) should = 2000 USDC (2000e6)
    mockFetchPrice
      .mockResolvedValueOnce(makePriceData(200000000000n)) // ETH = $2000
      .mockResolvedValueOnce(makePriceData(100000000n)); // USDC = $1

    const result = await convertTokenAmount(
      42161,
      ETH_ADDRESS,
      USDC_ADDRESS,
      1000000000000000000n // 1 ETH
    );

    // amountOut = amountIn * priceIn * 10^outDecimals / (priceOut * 10^inDecimals)
    // = 1e18 * 200000000000 * 1e6 / (100000000 * 1e18)
    // = 2000000000 = 2000 USDC
    expect(result).toBe(2000000000n);
  });

  it('converts USDC to ETH correctly', async () => {
    // 2000 USDC should = 1 ETH
    mockFetchPrice
      .mockResolvedValueOnce(makePriceData(100000000n)) // USDC = $1
      .mockResolvedValueOnce(makePriceData(200000000000n)); // ETH = $2000

    const result = await convertTokenAmount(
      42161,
      USDC_ADDRESS,
      ETH_ADDRESS,
      2000000000n // 2000 USDC
    );

    // = 2000e6 * 1e8 * 1e18 / (2000e8 * 1e6) = 1e18
    expect(result).toBe(1000000000000000000n);
  });

  it('handles zero amount', async () => {
    mockFetchPrice
      .mockResolvedValueOnce(makePriceData(200000000000n))
      .mockResolvedValueOnce(makePriceData(100000000n));

    const result = await convertTokenAmount(
      42161,
      ETH_ADDRESS,
      USDC_ADDRESS,
      0n
    );
    expect(result).toBe(0n);
  });

  it('fetches prices in parallel', async () => {
    mockFetchPrice
      .mockResolvedValueOnce(makePriceData(200000000000n))
      .mockResolvedValueOnce(makePriceData(100000000n));

    await convertTokenAmount(42161, ETH_ADDRESS, USDC_ADDRESS, 1000n);

    expect(mockFetchPrice).toHaveBeenCalledTimes(2);
    expect(mockFetchPrice).toHaveBeenCalledWith(42161, ETH_ADDRESS);
    expect(mockFetchPrice).toHaveBeenCalledWith(42161, USDC_ADDRESS);
  });

  it('propagates oracle errors', async () => {
    mockFetchPrice.mockRejectedValue(new Error('Oracle unavailable'));

    await expect(
      convertTokenAmount(42161, ETH_ADDRESS, USDC_ADDRESS, 1000n)
    ).rejects.toThrow('Oracle unavailable');
  });
});
