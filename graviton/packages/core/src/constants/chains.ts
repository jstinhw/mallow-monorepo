import { mainnet, base, arbitrum, optimism } from 'viem/chains';
import type { Chain } from 'viem';
import { config } from 'dotenv';
import { SupportedChainId, ChainConfig } from '../types/chains.js';
import { NATIVE_TOKEN } from '../types/tokens.js';

config();

export const supportedChainIds = [
  mainnet.id,
  optimism.id,
  arbitrum.id,
  base.id,
];

/**
 * Supported blockchain networks
 */
export const chainConfigs: Record<SupportedChainId, ChainConfig> = {
  // Ethereum Mainnet
  [mainnet.id]: {
    chain: mainnet,
    isMainnet: true,
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    bundlerRpcUrl: `https://rpc.zerodev.app/api/v3/${process.env.ZERODEV_API_KEY}/chain/1`,
    cctpDomain: 0,
    tokens: {
      ETH: {
        symbol: 'ETH',
        address: NATIVE_TOKEN,
        decimals: 18,
      },
      USDC: {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
        balanceOffset: 9,
      },
      USDT: {
        symbol: 'USDT',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
        balanceOffset: 2,
      },
    },
  },
  // Base
  [base.id]: {
    chain: base,
    isMainnet: true,
    wrappedNative: '0x4200000000000000000000000000000000000006',
    rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    bundlerRpcUrl: `https://rpc.zerodev.app/api/v3/${process.env.ZERODEV_API_KEY}/chain/8453`,
    cctpDomain: 6,
    tokens: {
      ETH: {
        symbol: 'ETH',
        address: NATIVE_TOKEN,
        decimals: 18,
      },
      USDC: {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
        balanceOffset: 9,
      },
      USDT: {
        symbol: 'USDT',
        address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
        decimals: 6,
        balanceOffset: 0,
      },
    },
  },
  // Arbitrum One
  [arbitrum.id]: {
    chain: arbitrum,
    isMainnet: true,
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    bundlerRpcUrl: `https://rpc.zerodev.app/api/v3/${process.env.ZERODEV_API_KEY}/chain/42161`,
    cctpDomain: 3,
    tokens: {
      ETH: {
        symbol: 'ETH',
        address: NATIVE_TOKEN,
        decimals: 18,
      },
      USDC: {
        symbol: 'USDC',
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
        balanceOffset: 9,
      },
      USDT: {
        symbol: 'USDT',
        address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        decimals: 6,
        balanceOffset: 51,
      },
    },
  },
  // Optimism
  [optimism.id]: {
    chain: optimism,
    isMainnet: true,
    wrappedNative: '0x4200000000000000000000000000000000000006',
    rpcUrl: `https://opt-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    bundlerRpcUrl: `https://rpc.zerodev.app/api/v3/${process.env.ZERODEV_API_KEY}/chain/10`,
    cctpDomain: 2,
    tokens: {
      ETH: {
        symbol: 'ETH',
        address: NATIVE_TOKEN,
        decimals: 18,
      },
      USDC: {
        symbol: 'USDC',
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        decimals: 6,
        balanceOffset: 9,
      },
      USDT: {
        symbol: 'USDT',
        address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        decimals: 6,
        balanceOffset: 0,
      },
    },
  },
} as const;

/**
 * Check if a chain ID is supported
 */
export function isChainSupported(
  chainId: number | bigint
): chainId is SupportedChainId {
  return (supportedChainIds as readonly number[]).includes(Number(chainId));
}

/**
 * Get chain info by ID
 */
export function getChainInfo(chainId: number | bigint) {
  if (!isChainSupported(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return chainConfigs[chainId];
}

export function getChain(chainId: number | bigint): Chain {
  const chainInfo = getChainInfo(chainId);
  return chainInfo.chain;
}

/**
 * Get RPC URL from chainId
 */
export function getRpcUrl(chainId: number | bigint): string {
  const chainInfo = getChainInfo(chainId);
  return chainInfo.rpcUrl;
}

export function getBundlerRpcUrl(chainId: number | bigint): string {
  const chainInfo = getChainInfo(chainId);
  return chainInfo.bundlerRpcUrl;
}

export function getCCTPDomain(chainId: number | bigint): number {
  const chainInfo = getChainInfo(chainId);
  return chainInfo.cctpDomain;
}

export function getCCTPUrl(chainId: number | bigint): string {
  const CCTP_API_URL = 'https://iris-api.circle.com/v2';
  const CCTP_TESTNET_API_URL = 'https://iris-api.circle.com/v2';

  const chainInfo = getChainInfo(chainId);
  return chainInfo.isMainnet ? CCTP_API_URL : CCTP_TESTNET_API_URL;
}
