import { hexToString, type Address, type Hex } from "viem";
import { CHAINS } from "@/lib/constants/chains";
import { WC_EVENTS, WC_METHODS } from "@/lib/constants/walletconnect";

export { WC_METHODS, WC_EVENTS } from "@/lib/constants/walletconnect";

export type WcUriResult = { ok: true; uri: string } | { ok: false; error: string };

export function parseWcUri(input: string): WcUriResult {
  const uri = input.trim();
  if (!uri) return { ok: false, error: "Paste a WalletConnect link." };
  if (!uri.startsWith("wc:"))
    return { ok: false, error: "That is not a WalletConnect (wc:) link." };
  return { ok: true, uri };
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "unknown";
  }
}

export function requestChainId(eip155Chain: string): number {
  const id = Number(eip155Chain.split(":")[1]);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid eip155 chain: "${eip155Chain}"`);
  return id;
}

// A WalletConnect request may carry an expiry (unix seconds). dApps like Uniswap
// set one, and once it passes the relay deletes the request — so any response we
// produce afterwards is undeliverable. Detecting an already-expired request lets
// us skip the (slow) review entirely instead of failing at the very end.
export function isRequestExpired(
  request: { expiryTimestamp?: number },
  nowMs: number = Date.now(),
): boolean {
  const { expiryTimestamp } = request;
  return typeof expiryTimestamp === "number" && expiryTimestamp * 1000 <= nowMs;
}

export type TxParam = {
  from: Address;
  to: Address;
  value?: string;
  data?: Hex;
  gas?: string;
  nonce?: string;
};

export type GuardianTxInput = {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
};

export function txParamToGuardianInput(param: TxParam, chainId: number): GuardianTxInput {
  return {
    chainId,
    from: param.from,
    to: param.to,
    value: param.value ? BigInt(param.value) : 0n,
    data: (param.data ?? "0x") as Hex,
  };
}

export type SignatureClassification =
  | { kind: "message"; account: Address; text: string; rawMessage: string }
  | { kind: "typedData"; account: Address; typedData: unknown; rawTypedData: string };

const isHex = (s: string): boolean => /^0x[0-9a-fA-F]*$/.test(s);

function decodeMessage(raw: string): string {
  if (isHex(raw)) {
    try {
      return hexToString(raw as Hex);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function classifySignature(method: string, params: unknown[]): SignatureClassification {
  if (method === "eth_signTypedData" || method === "eth_signTypedData_v4") {
    const account = params[0] as Address;
    const rawTypedData = params[1] as string;
    let typedData: unknown;
    try {
      typedData = typeof rawTypedData === "string" ? JSON.parse(rawTypedData) : rawTypedData;
    } catch {
      typedData = rawTypedData;
    }
    return { kind: "typedData", account, typedData, rawTypedData };
  }
  // personal_sign: [message, address]; eth_sign: [address, message]
  const [p0, p1] = params as [string, string];
  const [account, rawMessage] = method === "eth_sign" ? [p0, p1] : [p1, p0];
  return {
    kind: "message",
    account: account as Address,
    text: decodeMessage(rawMessage),
    rawMessage,
  };
}

export type SupportedNamespaces = {
  eip155: { chains: string[]; methods: string[]; events: string[]; accounts: string[] };
};

type ProposalNamespace = { chains?: string[] };
export type ProposalChainsSource = {
  requiredNamespaces?: Record<string, ProposalNamespace>;
  optionalNamespaces?: Record<string, ProposalNamespace>;
};

// Collect every eip155 chain id a dApp asks for across its required and
// optional namespaces. WalletConnect's buildApprovedNamespaces throws when a
// *required* chain is missing from what we advertise, so we must echo back
// whatever the dApp requests — not only the chains mallow has RPCs for.
function requestedEip155ChainIds(proposal: ProposalChainsSource): number[] {
  const fromNamespace = (ns?: Record<string, ProposalNamespace>): string[] =>
    Object.entries(ns ?? {}).flatMap(([key, value]) =>
      key === "eip155" || key.startsWith("eip155:") ? (value.chains ?? []) : [],
    );
  const refs = [
    ...fromNamespace(proposal.requiredNamespaces),
    ...fromNamespace(proposal.optionalNamespaces),
  ];
  return refs
    .map((ref) => Number(ref.split(":")[1]))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function buildSupportedNamespaces(
  eoa: Address,
  proposal: ProposalChainsSource = {},
): SupportedNamespaces {
  // Advertise the union of every chain mallow knows about and every chain the
  // dApp requests — NOT just RPC-configured ones. Connecting and signing (incl.
  // Uniswap's Permit2 typed-data) are RPC-independent: the EOA owns the same
  // address on every EVM chain. Only broadcasting a transaction needs a
  // configured RPC, which is enforced separately at sign time. Advertising only
  // mallow's own chains caused dApps whose active/required chain we didn't list
  // (e.g. Uniswap on Ethereum, after the Arbitrum-only migration) to have their
  // session approval rejected by buildApprovedNamespaces — the connection
  // dropped right after the user clicked confirm.
  const ids = Array.from(
    new Set<number>([...CHAINS.map((c) => c.chainId), ...requestedEip155ChainIds(proposal)]),
  );
  return {
    eip155: {
      chains: ids.map((id) => `eip155:${id}`),
      methods: [...WC_METHODS],
      events: [...WC_EVENTS],
      accounts: ids.map((id) => `eip155:${id}:${eoa}`),
    },
  };
}
