import { keccak256, type Address, type Hex, type PublicClient } from "viem"
import { resolveProxy } from "./proxy"
import { fetchVerifiedSource } from "./sourcify"
import { compile, type Compiled } from "../analyze/compile"
import type { AddressTagger, AddressTags } from "./tagging"

/** Extra signals collected for any address that isn't a resolved verified contract. */
export interface Enrichment {
  readonly nonce: number
  readonly sentTxs: boolean
  readonly tags: AddressTags
}

export type ContractInfo =
  | { readonly kind: "eoa"; readonly address: Address; readonly enrichment: Enrichment; readonly delegation?: Address }
  | { readonly kind: "undetermined"; readonly address: Address; readonly enrichment: Enrichment }
  | { readonly kind: "unverified"; readonly address: Address; readonly codehash: Hex; readonly implementation?: Address; readonly enrichment: Enrichment }
  | { readonly kind: "contract"; readonly address: Address; readonly codehash: Hex; readonly implementation?: Address; readonly contractName: string; readonly compiled: Compiled }

/** The only classification the analyzer can descend into: verified + compiled source. */
export type VerifiedContract = Extract<ContractInfo, { kind: "contract" }>

/** EIP-7702 delegation indicator: 0xef0100 ++ 20-byte delegate address (23 bytes). */
const EIP7702_PREFIX = "0xef0100"
function delegatedEoaTarget(code: Hex): Address | undefined {
  return code.length === 48 && code.slice(0, 8) === EIP7702_PREFIX ? (`0x${code.slice(8, 48)}` as Address) : undefined
}

async function enrich(publicClient: PublicClient, blockNumber: bigint, address: Address, tagger: AddressTagger): Promise<Enrichment> {
  const [nonce, tags] = await Promise.all([
    publicClient.getTransactionCount({ address, blockNumber }),
    tagger.tag(address),
  ])
  return { nonce, sentTxs: nonce > 0, tags }
}

/**
 * Classifies an address at the pinned block using three signals:
 *  1. code — `getCode`;
 *  2. sent txs — the account nonce (no code + sent txs ⇒ EOA, not an *undeployed* contract);
 *  3. tags — ENS / an external tagging service.
 *
 * EIP-7702 is handled explicitly: code `0xef0100…` is a **delegated EOA**, not a contract
 * (this is now common on mainnet, e.g. vitalik.eth). Verified contracts are proxy-resolved
 * and compiled; every non-verified address is enriched with the signals above.
 */
export async function loadContract(publicClient: PublicClient, blockNumber: bigint, chainId: number, address: Address, tagger: AddressTagger): Promise<ContractInfo> {
  const code = (await publicClient.getCode({ address, blockNumber })) ?? "0x"

  if (code !== "0x") {
    const delegate = delegatedEoaTarget(code)
    if (delegate) {
      return { kind: "eoa", address, enrichment: await enrich(publicClient, blockNumber, address, tagger), delegation: delegate }
    }
    const codehash = keccak256(code)
    const implementation = await resolveProxy(publicClient, blockNumber, address)
    const source = await fetchVerifiedSource(chainId, implementation ?? address)
    if (!source) {
      return { kind: "unverified", address, codehash, ...(implementation ? { implementation } : {}), enrichment: await enrich(publicClient, blockNumber, address, tagger) }
    }
    const compiled = await compile(source)
    return { kind: "contract", address, codehash, ...(implementation ? { implementation } : {}), contractName: compiled.contractName, compiled }
  }

  const enrichment = await enrich(publicClient, blockNumber, address, tagger)
  // no code + has sent txs ⇒ EOA; no code + never sent ⇒ ambiguous (EOA or undeployed contract)
  return enrichment.sentTxs ? { kind: "eoa", address, enrichment } : { kind: "undetermined", address, enrichment }
}
