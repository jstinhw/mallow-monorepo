import type { TokenName } from '../types/tokens.js';
import { type OracleFeedConfig, OracleType } from '../types/oracle.js';

export const ORACLES_REGISTRY: Record<TokenName, OracleFeedConfig[]> = {
  ETH: [
    {
      type: OracleType.CHAINLINK,
      chainId: 42161,
      address: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
      decimals: 8,
    },
  ],
  USDC: [
    {
      type: OracleType.CHAINLINK,
      chainId: 42161,
      address: '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
      decimals: 8,
    },
  ],
  USDT: [
    {
      type: OracleType.CHAINLINK,
      chainId: 42161,
      address: '0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7',
      decimals: 8,
    },
  ],
};
