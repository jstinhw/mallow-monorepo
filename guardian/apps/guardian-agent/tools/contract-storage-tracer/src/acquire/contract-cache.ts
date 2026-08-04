import type { Address, PublicClient } from "viem"
import { loadContract, type ContractInfo } from "./contract"
import type { AddressTagger } from "./tagging"

/** A memoized `loadContract` bound to one run's client/block/tagger. */
export type ContractLoader = (address: Address) => Promise<ContractInfo>

/**
 * Builds a contract loader that caches by lowercased address, so the multi-anchor pipeline
 * (which may revisit the same contract for several anchors) compiles each contract once. The
 * cache is a private closure over a Map, mirroring the compiler cache in `analyze/compile`.
 */
export function createContractLoader(publicClient: PublicClient, blockNumber: bigint, chainId: number, tagger: AddressTagger): ContractLoader {
  const cache = new Map<string, Promise<ContractInfo>>()
  return (address: Address): Promise<ContractInfo> => {
    const key = address.toLowerCase()
    const cached = cache.get(key)
    if (cached) return cached
    const pending = loadContract(publicClient, blockNumber, chainId, address, tagger)
    cache.set(key, pending)
    return pending
  }
}
