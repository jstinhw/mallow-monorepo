import type { Address, Hex } from "viem";

export type RiskLevel = "info" | "low" | "medium" | "high" | "critical";

export type GuardianAction =
  "decode_calldata" | "get_contract_info" | "simulate_transaction" | "lookup_sourcify_signature";

type GuardianFinding = {
  id: string;
  severity: RiskLevel;
  title: string;
  detail: string;
};

type GuardianCheck = {
  kind: "decode" | "contract" | "simulate" | "signature";
  ok: boolean;
  title: string;
  detail: string;
};

type SimulationSummary = {
  success: boolean;
  revertReason?: string;
  gasUsed: string;
  erc20Transfers: { token: Address; from: Address; to: Address; amount: string }[];
  erc721Transfers: { token: Address; from: Address; to: Address; tokenId: string }[];
  balanceDelta: { address: Address; deltaWei: string }[];
};

export type GuardianVerdict = {
  risk: RiskLevel;
  summary: string;
  impacts: string[];
  findings: GuardianFinding[];
  decoded: { selector: Hex; signature?: string; args?: unknown[] };
  simulation: SimulationSummary | null;
  llm: { reasoning: string; investigation?: string; checkReasoning?: string } | null;
  checks: GuardianCheck[];
  meta: { durationMs: number; simulator: "anvil-fork" };
};
