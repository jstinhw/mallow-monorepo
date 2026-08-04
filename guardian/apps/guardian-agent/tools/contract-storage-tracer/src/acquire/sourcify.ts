import type { Address } from "viem"
import { fetchWithBackoff } from "../utils/net"

const SOURCIFY = "https://sourcify.dev/server"

export interface VerifiedSource {
  readonly address: Address
  readonly contractName: string
  readonly compilerVersion: string
  /** path -> Solidity source. Keyed exactly as imports resolve (OZ paths, abs paths). */
  readonly sources: Record<string, string>
  readonly settings: {
    readonly optimizer?: { readonly enabled?: boolean; readonly runs?: number }
    readonly evmVersion?: string
  }
}

interface SourcifyV2Response {
  readonly sources?: Record<string, { readonly content?: string }>
  readonly compilation?: {
    readonly name?: string
    readonly compilerVersion?: string
    readonly compilerSettings?: {
      readonly optimizer?: { readonly enabled?: boolean; readonly runs?: number }
      readonly evmVersion?: string
    }
  }
}

/** Fetches verified sources from Sourcify V2 (keyless). Returns null if not verified. */
export async function fetchVerifiedSource(
  chainId: number,
  address: Address,
): Promise<VerifiedSource | null> {
  const url = `${SOURCIFY}/v2/contract/${chainId}/${address}?fields=sources,compilation`
  const res = await fetchWithBackoff(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`sourcify ${address} returned ${res.status}`)

  const data = (await res.json()) as SourcifyV2Response
  if (!data.sources || !data.compilation?.compilerVersion || !data.compilation.name) return null

  const sources = Object.fromEntries(
    Object.entries(data.sources)
      .filter(([, v]) => typeof v.content === "string")
      .map(([path, v]) => [path, v.content as string]),
  )
  const s = data.compilation.compilerSettings
  return {
    address,
    contractName: data.compilation.name,
    compilerVersion: data.compilation.compilerVersion,
    sources,
    settings: {
      ...(s?.optimizer ? { optimizer: s.optimizer } : {}),
      ...(s?.evmVersion ? { evmVersion: s.evmVersion } : {}),
    },
  }
}
