import { supportedChainIds } from '../constants';
import { type TokenName, type TokenInfo } from './tokens';
import type { Chain, Address } from 'viem';

export type SupportedChainId = (typeof supportedChainIds)[number];

/**
 * Chain config stored in constants.
 * rpcUrl is a lazy getter to allow env vars to load first.
 */
export interface ChainConfig {
  chain: Chain;
  isMainnet: boolean;
  wrappedNative: Address;
  rpcUrl: string;
  bundlerRpcUrl: string;
  cctpDomain: number;
  tokens: Partial<Record<TokenName, TokenInfo>>;
}
