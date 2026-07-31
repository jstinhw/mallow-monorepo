import type {
  Address,
  Hex,
  PublicClient,
  WalletClient,
  Transport,
  Chain,
  Account,
} from 'viem';

/**
 * Blockchain client bundle
 */
export interface BlockchainClient {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  account: { address: Address };
}

/**
 * Transaction receipt with common fields
 */
export interface TransactionResult {
  hash: Hex;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  gasUsed: bigint;
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCost: bigint;
}
