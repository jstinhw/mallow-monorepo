import type { Address } from "viem"
import type { ContractInfo } from "../acquire/contract"
import type { DecodedCall } from "../acquire/decode"
import type { AddressReport, CompressedContract, DecodedArg, DecodedSummary } from "../types/report"
import type { CompressedSlice } from "../analyze/slice"

function argValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") return value
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) ?? String(value)
}

/** Maps a decoded call to the report's summary, carrying argument names/types/values through. */
export function toDecodedSummary(call: DecodedCall): DecodedSummary {
  const args: DecodedArg[] = call.args.map((value, i) => {
    const input = call.inputs?.[i]
    return {
      ...(input?.name ? { name: input.name } : {}),
      ...(input?.type ? { type: input.type } : {}),
      value: argValue(value),
    }
  })
  return { selector: call.selector, functionName: call.functionName, source: call.source, args }
}

/** Turns a classified address into the report's per-address record. */
export function toAddressReport(info: ContractInfo): AddressReport {
  if (info.kind === "contract") return { address: info.address, classification: "contract", note: info.contractName }
  const { nonce, sentTxs, tags } = info.enrichment
  const base = {
    address: info.address,
    nonce,
    sentTxs,
    ...(tags.ens ? { ens: tags.ens } : {}),
    ...(tags.labels.length ? { labels: tags.labels } : {}),
  }
  if (info.kind === "eoa") {
    return { ...base, classification: "eoa", ...(info.delegation ? { delegation: info.delegation, note: `EIP-7702 delegated EOA → ${info.delegation}` } : {}) }
  }
  if (info.kind === "undetermined") {
    return { ...base, classification: "undetermined", note: "no code and no sent txs — EOA (unused) or an undeployed/counterfactual contract" }
  }
  return { ...base, classification: "unverified", note: "has code but source is not verified" }
}

/** Wraps a computed slice into the report's compressed-contract shape. */
export function toCompressed(address: Address, codehash: string, slice: CompressedSlice): CompressedContract {
  return { address, codehash, storage: slice.storage, functions: slice.functions, sourceSlice: slice.sourceSlice, verified: true }
}
