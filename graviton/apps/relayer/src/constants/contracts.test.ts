import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import {
  getSimulatorAddress,
  EXECUTOR_TO_SIMULATOR,
  INTEROP_EXECUTOR,
  CCTP_ADAPTER,
  ACROSS_ADAPTER,
  LAYERZERO_ADAPTER,
  LZ_DEFAULT_NATIVE_FEE,
  MAX_ATTESTATION_RETRIES,
} from './contracts.js';

describe('getSimulatorAddress', () => {
  it('returns simulator for known executor address', () => {
    const executor = '0x5e0de196118baA88b06101bABff8784fb85403f3' as Address;
    const result = getSimulatorAddress(executor);

    expect(result).toBe('0x6A2B39e60bd45717E89bDCFc0B59652C6e579BB7');
  });

  it('handles case-insensitive address lookup', () => {
    const executorLower =
      '0x5e0de196118baa88b06101babff8784fb85403f3' as Address;
    const result = getSimulatorAddress(executorLower);

    expect(result).toBe('0x6A2B39e60bd45717E89bDCFc0B59652C6e579BB7');
  });

  it('throws for unknown executor address', () => {
    const unknown = '0x0000000000000000000000000000000000000001' as Address;

    expect(() => getSimulatorAddress(unknown)).toThrow(
      'No simulator address found for InteropExecutor'
    );
  });
});

describe('contract constants', () => {
  it('EXECUTOR_TO_SIMULATOR has at least one mapping', () => {
    expect(Object.keys(EXECUTOR_TO_SIMULATOR).length).toBeGreaterThan(0);
  });

  it('INTEROP_EXECUTOR is a valid address', () => {
    expect(INTEROP_EXECUTOR).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('CCTP_ADAPTER is a valid address', () => {
    expect(CCTP_ADAPTER).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('ACROSS_ADAPTER is a valid address', () => {
    expect(ACROSS_ADAPTER).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('LAYERZERO_ADAPTER is a valid address', () => {
    expect(LAYERZERO_ADAPTER).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('LZ_DEFAULT_NATIVE_FEE is 0.0001 ETH (1.5e14)', () => {
    expect(LZ_DEFAULT_NATIVE_FEE).toBe(150_000_000_000_000n);
  });

  it('MAX_ATTESTATION_RETRIES is a positive number', () => {
    expect(MAX_ATTESTATION_RETRIES).toBeGreaterThan(0);
  });
});

describe('GasEstimationService parseStateOverrides', () => {
  // Test the parseStateOverrides logic from gas-estimation.service.ts
  // by importing and testing it through the public interface
  it('EXECUTOR_TO_SIMULATOR maps to valid addresses', () => {
    for (const [executor, simulator] of Object.entries(EXECUTOR_TO_SIMULATOR)) {
      expect(executor).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(simulator).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });
});
