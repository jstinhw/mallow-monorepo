import { Address } from 'viem';

export const BPS_BASE = 10n ** 18n;

export const defaultSenderAddress: Address =
  '0xeFf66A7c20ea05ae74cE801Dbb9B099a1E1DD830';

export const SWAP_TYPES = ['EXACT_INPUT', 'EXACT_OUTPUT'] as const;

export const BRIDGE_TYPES = ['CCTP', 'ACROSS', 'RELAY'] as const;
