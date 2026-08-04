import { arbitrum, base, bsc, mainnet, optimism, polygon, type Chain } from "viem/chains"
import { z } from "zod"

export interface SupportedChain {
  readonly chain: Chain
  /** Resolved RPC URL. */
  readonly rpcUrl: string
}

function alchemyRpcUrl(network: string): string {
  return `https://${network}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY ?? ""}`
}

/** Chains the tracer can connect to. Add an entry here to support a new chain. */
export const SUPPORTED_CHAINS: Record<number, SupportedChain> = {
  [mainnet.id]: { chain: mainnet, get rpcUrl() { return alchemyRpcUrl("eth-mainnet") } },
  [arbitrum.id]: { chain: arbitrum, get rpcUrl() { return alchemyRpcUrl("arb-mainnet") } },
  [bsc.id]: { chain: bsc, get rpcUrl() { return alchemyRpcUrl("bnb-mainnet") } },
  [base.id]: { chain: base, get rpcUrl() { return alchemyRpcUrl("base-mainnet") } },
  [optimism.id]: { chain: optimism, get rpcUrl() { return alchemyRpcUrl("opt-mainnet") } },
  [polygon.id]: { chain: polygon, get rpcUrl() { return alchemyRpcUrl("polygon-mainnet") } },
}

const supportedChainIds = Object.keys(SUPPORTED_CHAINS).map(Number)
const supportedChainIdSet = new Set(supportedChainIds)

export const chainIdSchema = z.coerce
  .number()
  .int()
  .refine((id): id is number => supportedChainIdSet.has(id), (id) => ({
    message: `unsupported chainId ${id}; supported: ${supportedChainIds.join(", ")}`,
  }))

/** Validates `chainId` and returns its chain definition + resolved RPC endpoint. */
export function getSupportedChain(chainId: number): SupportedChain {
  const id = chainIdSchema.parse(chainId)
  const entry = SUPPORTED_CHAINS[id]
  if (!entry) throw new Error(`unsupported chainId ${id}`)
  return entry
}
