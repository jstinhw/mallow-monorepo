import { describe, it, expect } from 'vitest';
import {
  normalizeAmount,
  getCCTPDomain,
  encodeCCTPAdapterData,
  encodeBalanceValidatorData,
  calculateFee,
  calculateSourceAmount,
  encodeExecutionCall,
  isUSDC,
  getLZEndpointId,
  encodeLZOptions,
  encodeLZAdapterData,
} from './order.utils.js';
import type { Address, Hex } from 'viem';

describe('normalizeAmount', () => {
  it('returns same amount when decimals are equal', () => {
    expect(normalizeAmount(1000n, 6, 6)).toBe(1000n);
  });

  it('scales down when fromDecimals > toDecimals', () => {
    // 1e18 with 18 decimals -> 6 decimals = 1e6
    expect(normalizeAmount(1000000000000000000n, 18, 6)).toBe(1000000n);
  });

  it('scales up when fromDecimals < toDecimals', () => {
    // 1e6 with 6 decimals -> 18 decimals = 1e18
    expect(normalizeAmount(1000000n, 6, 18)).toBe(1000000000000000000n);
  });

  it('handles zero amount', () => {
    expect(normalizeAmount(0n, 18, 6)).toBe(0n);
    expect(normalizeAmount(0n, 6, 18)).toBe(0n);
  });

  it('truncates when scaling down (no rounding)', () => {
    // 1500000000000 / 10^12 = 1 (integer division truncates)
    expect(normalizeAmount(1500000000000n, 18, 6)).toBe(1n);
    // Sub-unit amounts truncate to zero
    expect(normalizeAmount(999999999999n, 18, 6)).toBe(0n);
  });
});

describe('getCCTPDomain', () => {
  it('returns correct domain for Arbitrum', () => {
    expect(getCCTPDomain(42161n)).toBe(3);
  });

  it('returns correct domain for Base', () => {
    expect(getCCTPDomain(8453n)).toBe(6);
  });

  it('returns correct domain for Optimism', () => {
    expect(getCCTPDomain(10n)).toBe(2);
  });

  it('throws for unsupported chain', () => {
    expect(() => getCCTPDomain(999n)).toThrow(
      'No CCTP domain configured for chain 999'
    );
  });
});

describe('encodeCCTPAdapterData', () => {
  it('encodes parameters as ABI data', () => {
    const result = encodeCCTPAdapterData({
      destinationDomain: 3,
      destinationCaller:
        '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex,
      maxFee: 1000n,
      minFinalityThreshold: 1,
    });

    expect(result).toBeDefined();
    expect(result.startsWith('0x')).toBe(true);
    // ABI encoded data is always 32-byte aligned
    expect((result.length - 2) % 64).toBe(0);
  });
});

describe('encodeBalanceValidatorData', () => {
  it('encodes address and amount', () => {
    const amount = 1000000n;
    const result = encodeBalanceValidatorData(amount);

    expect(result).toBeDefined();
    expect(result.startsWith('0x')).toBe(true);
    expect((result.length - 2) % 64).toBe(0);
  });
});

describe('calculateFee', () => {
  it('calculates fee with both bps and gas', () => {
    const balance = 1000000000000000000n; // 1e18
    const bps = 30n; // 30 bps
    const gasAmount = 100000n;
    const baseDecimals = 18;

    const result = calculateFee(balance, bps, gasAmount, baseDecimals);
    // bpsFee = (1e18 * 30) / 1e18 = 30
    // total = 30 + 100000 = 100030
    expect(result).toBe(100030n);
  });

  it('returns only gas when bps is zero', () => {
    const result = calculateFee(1000000n, 0n, 5000n, 6);
    expect(result).toBe(5000n);
  });

  it('returns only bps fee when gas is zero', () => {
    const balance = 1000000n; // 1 USDC (6 decimals)
    const bps = 100n; // 100 bps = 1%
    const result = calculateFee(balance, bps, 0n, 6);
    // bpsFee = (1000000 * 100) / 1000000 = 100
    expect(result).toBe(100n);
  });

  it('returns zero when both bps and gas are zero', () => {
    expect(calculateFee(1000000n, 0n, 0n, 6)).toBe(0n);
  });
});

describe('calculateSourceAmount', () => {
  it('calculates source amount accounting for fees', () => {
    const targetAmount = 1000000n;
    const bps = 100n; // 1%
    const baseDecimals = 6;
    const baseUnit = BigInt(10 ** 6);

    const result = calculateSourceAmount(targetAmount, bps, baseDecimals);

    // denominator = baseUnit - bps = 999900
    // result = ceil(1000000 * 1000000 / 999900)
    // The source amount should be slightly more than target to cover fees
    expect(result).toBeGreaterThan(targetAmount);

    // Verify the fee math roundtrips: sourceAmount - fee >= targetAmount
    const fee = (result * bps) / baseUnit;
    expect(result - fee).toBeGreaterThanOrEqual(targetAmount);
  });

  it('returns target amount when bps is zero', () => {
    const result = calculateSourceAmount(1000000n, 0n, 6);
    expect(result).toBe(1000000n);
  });
});

describe('encodeExecutionCall', () => {
  const singleCall = {
    to: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    value: 0n,
    data: '0x' as Hex,
  };

  it('uses single call mode for one call', () => {
    const result = encodeExecutionCall([singleCall]);

    expect(result[0]!.mode).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    );
    expect(result[0]!.data).toBeDefined();
    expect(result[0]!.data.startsWith('0x')).toBe(true);
  });

  it('uses batch call mode for multiple calls', () => {
    const result = encodeExecutionCall([singleCall, singleCall]);

    expect(result[0]!.mode).toBe(
      '0x0100000000000000000000000000000000000000000000000000000000000000'
    );
    expect(result[0]!.data).toBeDefined();
    expect(result[0]!.data.startsWith('0x')).toBe(true);
  });
});

describe('isUSDC', () => {
  const usdcAddresses: Record<number, Address> = {
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  };

  it('returns true for matching USDC address', () => {
    expect(
      isUSDC(
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
        42161n,
        usdcAddresses
      )
    ).toBe(true);
  });

  it('returns true for case-insensitive match', () => {
    expect(
      isUSDC(
        '0xAF88D065E77C8CC2239327C5EDB3A432268E5831' as Address,
        42161n,
        usdcAddresses
      )
    ).toBe(true);
  });

  it('returns false for non-USDC address', () => {
    expect(
      isUSDC(
        '0x0000000000000000000000000000000000000001' as Address,
        42161n,
        usdcAddresses
      )
    ).toBe(false);
  });

  it('returns false for unsupported chain', () => {
    expect(
      isUSDC(
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
        999n,
        usdcAddresses
      )
    ).toBe(false);
  });
});

describe('getLZEndpointId', () => {
  it('returns correct endpoint ID for Arbitrum', () => {
    expect(getLZEndpointId(42161n)).toBe(30110);
  });

  it('returns correct endpoint ID for Base', () => {
    expect(getLZEndpointId(8453n)).toBe(30184);
  });

  it('returns correct endpoint ID for Optimism', () => {
    expect(getLZEndpointId(10n)).toBe(30111);
  });

  it('throws for unsupported chain', () => {
    expect(() => getLZEndpointId(999n)).toThrow(
      'No LayerZero endpoint ID configured for chain 999'
    );
  });
});

describe('encodeLZOptions', () => {
  it('encodes options with type 3 format prefix', () => {
    const result = encodeLZOptions(200000n);

    expect(result).toBeDefined();
    expect(result.startsWith('0x')).toBe(true);
    // type(2) + workerId(1) + length(2) + optionType(1) + gasLimit(16) = 22 bytes = 44 hex chars + 0x prefix
    expect(result.length).toBe(46);
    // First 4 hex chars = uint16(3) = 0x0003
    expect(result.slice(2, 6)).toBe('0003');
  });

  it('encodes different gas limits', () => {
    const low = encodeLZOptions(100000n);
    const high = encodeLZOptions(500000n);

    expect(low).not.toBe(high);
  });
});

describe('encodeLZAdapterData', () => {
  it('encodes parameters as ABI data', () => {
    const result = encodeLZAdapterData({
      dstEid: 30110,
      options: '0x0003' as Hex,
      refundAddress: '0x1234567890123456789012345678901234567890' as Address,
    });

    expect(result).toBeDefined();
    expect(result.startsWith('0x')).toBe(true);
    // ABI encoded data is always 32-byte aligned
    expect((result.length - 2) % 64).toBe(0);
  });

  it('encodes with empty options', () => {
    const result = encodeLZAdapterData({
      dstEid: 30184,
      options: '0x' as Hex,
      refundAddress: '0x1234567890123456789012345678901234567890' as Address,
    });

    expect(result).toBeDefined();
    expect(result.startsWith('0x')).toBe(true);
  });
});
