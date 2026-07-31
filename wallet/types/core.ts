import type { Address } from "viem";

export type TokenHolding = {
  chainId: number;
  tokenAddress: Address;
  amount: string;
  decimals: number;
  usdAmount: number | null;
  name: string;
  symbol: string;
  owner: Address;
};
