import type { Address } from 'viem';

interface TriedChain {
  readonly chainId: bigint;
  readonly tokens: ReadonlyArray<{ address: Address; amount: bigint }>;
}

export class GasOnlyInsufficientFundsError extends Error {
  constructor(
    public readonly targetChainId: bigint,
    public readonly triedChains: ReadonlyArray<TriedChain>
  ) {
    const chainSummaries = triedChains
      .map((chain) => {
        const tokenList = chain.tokens
          .map((t) => `${t.address} (${t.amount})`)
          .join(', ');
        return `chain ${chain.chainId}: [${tokenList}]`;
      })
      .join('; ');

    super(
      `Insufficient funds for gas-only order on target chain ${targetChainId}. ` +
        `Tried source tokens: ${chainSummaries || 'none'}`
    );
    this.name = 'GasOnlyInsufficientFundsError';
  }
}
