import type { Address } from 'viem';

/**
 * Supported oracle types
 */
export enum OracleType {
  CHAINLINK = 'chainlink',
  PYTH = 'pyth',
  REDSTONE = 'redstone',
}

/**
 * Price data returned from oracles
 */
export interface PriceData {
  /** Price in USD (scaled by priceDecimals) */
  price: bigint;
  /** Price feed decimals */
  priceDecimals: number;
  /** Last update timestamp */
  updatedAt: bigint;
  /** Oracle source that provided the price */
  source: OracleType;
}

/**
 * Oracle feed configuration
 */
export interface OracleFeedConfig {
  type: OracleType;
  chainId: number;
  /** Feed address or identifier */
  address: Address;
  /** Price feed decimals */
  decimals: number;
}

/**
 * Oracle provider interface - implement this for new oracle types
 */
export interface OracleProvider {
  readonly type: OracleType;
  fetchPrice(feedConfig: OracleFeedConfig): Promise<PriceData>;
}
