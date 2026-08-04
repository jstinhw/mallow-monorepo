import { keccak256, toHex, type Address, type Hex, type PublicClient } from "viem"

/** Known implementation-pointer storage slots, tried in order. */
const IMPL_SLOTS: Record<string, Hex> = {
  // EIP-1967: keccak256("eip1967.proxy.implementation") - 1
  "eip-1967": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  // zeppelinos (used by USDC's FiatTokenProxy): keccak256("org.zeppelinos.proxy.implementation")
  "zeppelinos": keccak256(toHex("org.zeppelinos.proxy.implementation")),
}

/**
 * Well-known proxy bookkeeping slots (implementation/admin/beacon pointers). These are not
 * anchor-relevant application state, so slot attribution filters them out rather than reporting
 * them as written variables. Lowercased for set membership.
 */
export const PROXY_META_SLOTS: ReadonlySet<string> = new Set(
  [
    IMPL_SLOTS["eip-1967"]!,
    IMPL_SLOTS["zeppelinos"]!,
    // EIP-1967 admin: keccak256("eip1967.proxy.admin") - 1
    "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    // EIP-1967 beacon: keccak256("eip1967.proxy.beacon") - 1
    "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  ].map((s) => s.toLowerCase()),
)

function slotToAddress(word: Hex): Address | undefined {
  const hex = word.replace(/^0x/, "").padStart(64, "0")
  const addr = `0x${hex.slice(24)}` as Address
  return /^0x0{40}$/.test(addr) ? undefined : addr
}

/**
 * Detects the common implementation-slot proxy patterns by reading well-known slots at the
 * pinned block. Deterministic — the implementation address is on-chain state, not a guess.
 * Returns the implementation address, or undefined when no known slot is set.
 */
export async function resolveProxy(publicClient: PublicClient, blockNumber: bigint, address: Address): Promise<Address | undefined> {
  for (const slot of Object.values(IMPL_SLOTS)) {
    const word = (await publicClient.getStorageAt({ address, slot, blockNumber })) ?? "0x"
    const impl = slotToAddress(word)
    if (impl) return impl
  }
  return undefined
}
