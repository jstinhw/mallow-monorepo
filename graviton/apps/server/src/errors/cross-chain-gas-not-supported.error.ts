export class CrossChainGasNotSupportedError extends Error {
  constructor(public readonly srcChainId: bigint) {
    super(
      `Cross-chain tokens (srcChainId: ${srcChainId}) cannot be used for gas-only payments. ` +
        'All target token amounts are already fulfilled. ' +
        'Pure gas payment via cross-chain tokens is not supported yet.'
    );
    this.name = 'CrossChainGasNotSupportedError';
  }
}
