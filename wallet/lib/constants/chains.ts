import { arbitrum, type Chain } from "viem/chains";

export const DEFAULT_CHAIN_ID = 42161;

export type ChainConfig = {
  chainId: number;
  chain: Chain;
  color: string;
  rpcUrl: string | null;
};

// Alchemy network slugs, shared by RPC URL construction and the token data API.
export const ALCHEMY_NETWORKS: Record<number, string> = {
  42161: "arb-mainnet",
};

// Single Alchemy key drives every chain's RPC. NEXT_PUBLIC_ so it reaches the
// browser bundle — the wallet clients that sign/send transactions run client-side.
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? null;

function alchemyRpcUrl(chainId: number): string | null {
  const network = ALCHEMY_NETWORKS[chainId];
  if (!network || !ALCHEMY_API_KEY) return null;
  return `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
}

export const CHAINS: ChainConfig[] = [
  { chainId: 42161, chain: arbitrum, color: "#12aaff", rpcUrl: alchemyRpcUrl(42161) },
];

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS.find((c) => c.chainId === chainId);
}

export function tokenKey(symbol: string, address: string | null): string {
  return `${symbol}:${address !== null ? address.toLowerCase() : "native"}`;
}

export function txExplorerUrl(chainId: number, txHash: string): string {
  const explorerUrl = getChain(chainId)?.chain.blockExplorers?.default.url;
  if (!explorerUrl) throw new Error(`Unsupported chainId: ${chainId}`);
  return `${explorerUrl}/tx/${txHash}`;
}
