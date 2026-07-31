import type { Address } from 'viem';

export class InsufficientGasError extends Error {
  constructor(
    public readonly token: Address,
    public readonly amount: bigint,
    public readonly formattedAmount: string
  ) {
    super(`Insufficient gas payment: need ${formattedAmount} more of ${token}`);
    this.name = 'InsufficientGasError';
  }
}
