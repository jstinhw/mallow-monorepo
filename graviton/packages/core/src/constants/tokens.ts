import {
  isAddressEqual,
  type Address,
  type Hex,
  keccak256,
  concat,
  pad,
  toHex,
} from 'viem';
import { getChainInfo } from './chains.js';
import {
  NATIVE_TOKEN,
  type TokenInfo,
  type TokenName,
  type TokenConfig,
} from '../types/index.js';
import { ORACLES_REGISTRY } from './oracles.js';

export const tokenConfigs: Record<TokenName, TokenConfig> = {
  ETH: {
    oracles: ORACLES_REGISTRY.ETH,
    stubAmount: 0.01,
  },
  USDC: {
    oracles: ORACLES_REGISTRY.USDC,
    stubAmount: 10,
  },
  USDT: {
    oracles: ORACLES_REGISTRY.USDT,
    stubAmount: 10,
  },
};

/**
 * Get token info by chain ID and token address
 */
export function getTokenInfo(
  chainId: number,
  tokenAddress: Address
): TokenInfo | undefined {
  const tokens = getChainInfo(chainId).tokens;

  // Find token by address (case-insensitive comparison)
  return Object.entries(tokens).find(([, info]) =>
    isAddressEqual(info.address, tokenAddress)
  )?.[1];
}

/**
 * Get token balance offset by chain ID and token address
 */
export function getTokenBalanceSlot(
  chainId: number,
  tokenAddress: Address,
  sender: Address
): Hex {
  const offset = getTokenInfo(chainId, tokenAddress)?.balanceOffset;
  if (offset === undefined) {
    throw new Error(`Token ${tokenAddress} not found on chain ${chainId}`);
  }
  return keccak256(concat([pad(sender), toHex(offset, { size: 32 })]));
}

/**
 * Get token name by chain ID and token address
 */
export function getTokenName(
  chainId: number,
  tokenAddress: Address
): TokenName {
  const tokenName = getTokenInfo(chainId, tokenAddress)?.symbol;
  if (tokenName === undefined) {
    throw new Error(`Token ${tokenAddress} not found on chain ${chainId}`);
  }
  return tokenName;
}

/**
 * Get token decimals by chain ID and token address
 */
export function getTokenDecimals(
  chainId: number,
  tokenAddress: Address
): number {
  const decimals = getTokenInfo(chainId, tokenAddress)?.decimals;
  if (decimals === undefined) {
    throw new Error(`Token ${tokenAddress} not found on chain ${chainId}`);
  }
  return decimals;
}

/**
 * Check if an address is the native token
 */
export function isNativeToken(address: Address): boolean {
  return isAddressEqual(address, NATIVE_TOKEN);
}

/**
 * Get USDC address for a given chain ID
 */
export function getUSDCAddress(chainId: number): Address {
  const usdcToken = getChainInfo(chainId).tokens.USDC;
  if (!usdcToken) {
    throw new Error(`USDC not supported on chain ${chainId}`);
  }
  return usdcToken.address;
}

/**
 * Check if a token address is USDC on the given chain
 */
export function isUSDC(chainId: number, tokenAddress: Address): boolean {
  const usdcAddress = getUSDCAddress(chainId);
  return isAddressEqual(tokenAddress, usdcAddress);
}
