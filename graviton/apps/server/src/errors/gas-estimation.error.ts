export class GasEstimationError extends Error {
  constructor(
    message: string,
    public readonly chainId: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GasEstimationError';
  }
}
