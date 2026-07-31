import { zeroAddress, type Address } from 'viem';
import { OracleFeedConfig } from './oracle';

export type TokenName = 'ETH' | 'USDC' | 'USDT';

/**
 * Native token address (same as Solidity NATIVE_TOKEN constant)
 */
export const NATIVE_TOKEN: Address = zeroAddress;

export interface TokenInfo {
  address: Address;
  symbol: TokenName;
  balanceOffset?: number;
  decimals: number;
}

export interface TokenConfig {
  oracles: OracleFeedConfig[];
  stubAmount: number;
}
