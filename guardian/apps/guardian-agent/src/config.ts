import { config } from "dotenv";
config();

export type ChainConfig = { chainId: number; name: string; rpcUrl?: string };

const env = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

function getArbitrumRpc(): string | undefined {
  const key = env("ALCHEMY_API_KEY");
  if (!key) return undefined;

  return `https://arb-mainnet.g.alchemy.com/v2/${key}`;
}

function getBscRpc(): string {
  // bsc-dataseed1.defibit.io provides full archive state needed for Anvil forking.
  return env("BSC_RPC_URL") ?? "https://bsc-dataseed1.defibit.io/";
}

export const CHAIN_RPC: Record<number, string | undefined> = {
  get 42161() {
    return getArbitrumRpc();
  },
  get 56() {
    return getBscRpc();
  },
};

export const CHAINS: ChainConfig[] = [
  {
    chainId: 42161,
    name: "Arbitrum",
    get rpcUrl() {
      return getArbitrumRpc();
    },
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    get rpcUrl() {
      return getBscRpc();
    },
  },
];

export function rpcUrlForChain(chainId: number): string | undefined {
  if (chainId === 42161) return getArbitrumRpc();
  if (chainId === 56) return getBscRpc();
  return undefined;
}

export const etherscanKey = (): string => env("ETHERSCAN_API_KEY") ?? "";

export const llmConfig = () => ({
  baseUrl: env("LLM_BASE_URL") ?? "http://localhost:1234/v1",
  apiKey: env("LLM_API_KEY") ?? "lm-studio",
  model: env("LLM_MODEL") ?? "qwen/qwen3.6-27b",
});
