import type { Address } from 'viem';
import { BRIDGE_TYPES, SWAP_TYPES } from '../constants/quote.js';

/**
 * Shared enums for quoter API
 */
export type SwapType = (typeof SWAP_TYPES)[number];
export type BridgeType = (typeof BRIDGE_TYPES)[number];

/**
 * Wire-format token info
 */
export interface QuoteToken {
  address: Address;
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
}

/**
 * Wire-format fee detail
 */
export interface QuoteFee {
  type: 'swap' | 'bridge' | 'gas';
  amount: bigint;
  token: QuoteToken;
  amountUsd?: string;
}

/**
 * Wire-format quote detail item
 */
export interface QuoteDetailItem {
  type: 'swap' | 'bridge';
  inputToken: QuoteToken;
  outputToken: QuoteToken;
  inputAmount: bigint;
  outputAmount: bigint;
  gasEstimate: bigint;
  protocol: string;
}

export interface TokenWithAmount {
  address: Address;
  amount: bigint;
}
