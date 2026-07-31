import type { Address } from 'viem';
import { arbitrum, base, optimism } from 'viem/chains';

export const INTEROP_EXECUTOR: Address =
  '0x9df84e4086a5CDe2639AB1D6673EC899D95f9cAE';
export const CCTP_ADAPTER: Address =
  '0x6726934014A521F60acA9280137bfb3A86B25b0e';
export const LAYERZERO_ADAPTER: Address =
  '0x9DB22E287f842EA2732bFB21d055E6ceF6fB530f';
export const BALANCE_VALIDATOR_ADDRESS: Address =
  '0x5Cb26c894C4EFA4D14c0e7471d20e2f0129722ca';
export const PAYMENT_RECIPIENT_ADDRESS: Address =
  '0xE0fB05154Ea1d255e49655b6599E0057890189eF';

export const SUPPORTED_CHAINS = {
  42161: arbitrum,
  8453: base,
  10: optimism,
} as const;

export const CCTP_DOMAINS: Record<number, number> = {
  42161: 3, // Arbitrum
  8453: 6, // Base
  10: 2, // Optimism
};

export const BASE_DECIMALS = 18;

// USDC addresses by chain ID
export const USDC_ADDRESSES: Record<number, Address> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum Mainnet
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Optimism
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum One
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
};

export const FEE_RECIPIENT_ADDRESS: Address =
  '0xE0fB05154Ea1d255e49655b6599E0057890189eF';

// LayerZero v2 endpoint IDs per chain
export const LZ_ENDPOINT_IDS: Record<number, number> = {
  42161: 30110, // Arbitrum
  8453: 30184, // Base
  10: 30111, // Optimism
};

// Default gas limit for LZ destination execution
export const LZ_DEFAULT_DST_GAS_LIMIT = 2_000_000n;

// Default native ETH fee for LayerZero messaging (adapter refunds unused)
export const LZ_DEFAULT_NATIVE_FEE = 150_000_000_000_000n;
