import type { Address } from 'viem';

export class InsufficientOutputError extends Error {
  constructor(
    public readonly accumulatedOutput: Map<Address, bigint>,
    public readonly targetAmounts: Map<Address, bigint>
  ) {
    const shortfalls = Array.from(targetAmounts.entries())
      .filter(
        ([address, required]) =>
          (accumulatedOutput.get(address) ?? 0n) < required
      )
      .map(
        ([address, required]) =>
          `${address}: accumulated ${accumulatedOutput.get(address) ?? 0n}, target ${required}`
      )
      .join('; ');
    super(`Insufficient output amount: ${shortfalls}`);
    this.name = 'InsufficientOutputError';
  }
}
