import type { Address, Hex } from 'viem';

export type RiskLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type GuardianFinding = {
  id: string;
  severity: RiskLevel;
  title: string;
  detail: string;
};

export type GuardianCheck = {
  kind: 'decode' | 'contract' | 'simulate' | 'signature';
  ok: boolean;
  title: string;
  detail: string;
};

export type SimulationSummary = {
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
  meta: { durationMs: number; simulator: 'anvil-fork' };
};

/**
 * EIP-712 payload for an `eth_signTypedData_v4` review. Kept structural rather
 * than viem's `TypedDataDefinition` so callers can hand over whatever the dApp
 * sent without re-typing it.
 */
export type GuardianTypedData = {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

/** A transaction request to review. `value` is wei. */
export type GuardianRequest = {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint | string;
  data: Hex;
  typedData?: GuardianTypedData;
};

/**
 * Progress events streamed while the agent works. Mirrors the guardian-agent
 * `ProgressEvent` union; `stage` is the discriminant.
 */
export type GuardianProgress =
  | { stage: 'plan' }
  | { stage: 'plan_ready'; actions: string[]; reasoning: string }
  | { stage: 'analyze' }
  | { stage: 'analyze_thinking'; round: number; intent: string }
  | { stage: 'analyze'; phase: 'tool_start'; callId: string; round: number; label: string }
  | {
      stage: 'analyze';
      phase: 'tool_complete';
      callId: string;
      round: number;
      label: string;
      ok: boolean;
      durationMs: number;
      summary: string;
    }
  | { stage: 'llm' }
  | { stage: 'llm_delta'; field: 'summary' | 'reasoning'; text: string }
  | { stage: 'verdict' };
