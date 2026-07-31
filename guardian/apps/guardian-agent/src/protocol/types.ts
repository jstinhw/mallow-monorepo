import type { Address, Hex } from "viem";

export type RiskLevel = "info" | "low" | "medium" | "high" | "critical";

export type Finding = {
  id: string;
  severity: RiskLevel;
  title: string;
  detail: string;
};

export type GuardianInput = {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  // EIP-712 typed data, in spec key order. `types` maps each struct name to its
  // ordered member list ({ name, type }); `domain` carries the canonical
  // EIP712Domain fields (all optional). See ../eip712/schema for validation.
  typedData?: {
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    domain: Record<string, unknown>;
    message: Record<string, unknown>;
  };
};

export type Erc20Transfer = { token: Address; from: Address; to: Address; amount: bigint };
export type Erc721Transfer = { token: Address; from: Address; to: Address; tokenId: bigint };
export type BalanceChange = { address: Address; before: bigint; after: bigint; deltaWei: bigint };
export type StorageDiff = { address: Address; slot: Hex; before: Hex; after: Hex };

export type TraceCall = {
  type: "CALL" | "STATICCALL" | "DELEGATECALL" | "CREATE" | "SELFDESTRUCT";
  from: Address;
  to: Address;
  value?: bigint;
  input?: Hex;
  output?: Hex;
  gasUsed?: bigint;
  error?: string;
  calls?: TraceCall[];
};

export type SimulationResult = {
  success: boolean;
  revertReason?: string;
  gasUsed: bigint;
  trace: TraceCall;
  balanceChanges: BalanceChange[];
  erc20Transfers: Erc20Transfer[];
  erc721Transfers: Erc721Transfer[];
  storageDiffs: StorageDiff[];
};

export type SimulationSummary = {
  success: boolean;
  revertReason?: string;
  gasUsed: string;
  erc20Transfers: { token: Address; from: Address; to: Address; amount: string }[];
  erc721Transfers: { token: Address; from: Address; to: Address; tokenId: string }[];
  balanceDelta: { address: Address; deltaWei: string }[];
};

export type GuardianCheck = {
  kind: "decode" | "contract" | "simulate" | "signature";
  ok: boolean;
  title: string;
  detail: string;
};

export type GuardianVerdict = {
  risk: RiskLevel;
  summary: string;
  impacts: string[];
  findings: Finding[];
  decoded: { selector: Hex; signature?: string; args?: unknown[] };
  simulation: SimulationSummary | null;
  llm: { reasoning: string; investigation?: string; checkReasoning?: string } | null;
  checks: GuardianCheck[];
  meta: { durationMs: number; simulator: "anvil-fork" };
};

export type ContractInfo = {
  address: Address;
  verified: boolean;
  name?: string;
  abi?: unknown[];
  isProxy: boolean;
  implementation?: Address;
  sourceCode?: string;
};
