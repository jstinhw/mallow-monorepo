import type { Address, Hex, Abi } from "viem";
import type { AgentRequest } from "@mallow/agents-protocol";
import type { GuardianAction, RiskLevel } from "@/types/guardian";

export type AutoInvestPermission = {
  target: Address;
  abi: Abi;
  functionName: string;
  args?: ReadonlyArray<unknown>;
};

export type AssetDiffRow = {
  sym: string;
  delta: number | "∞";
  fiat: number | null;
  hostile?: boolean;
};

export type CounterpartyKind = "verified" | "unverified" | "eoa";

export type Counterparty = {
  name: string;
  verified: boolean;
  kind?: CounterpartyKind; // optional override; defaults to verified ? "verified" : "unverified"
  age: string;
  contracts: number;
};

export type QueueFinding = {
  sev: RiskLevel;
  title: string;
  detail: string;
};

export type QueueCheck = {
  kind: "decode" | "contract" | "simulate" | "signature";
  ok: boolean;
  title: string;
  detail: string;
};

export type LiveStage = "plan" | "analyze" | "llm" | "verdict" | "ready" | "error";

export type LiveAction = {
  callId: string;
  round: number;
  label: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
  summary?: string;
};

export type LiveStatus = {
  tx: { from: Address; to: Address; value: string; data: Hex }; // value as decimal-string wei
  stage: LiveStage;
  chainId?: number;
  error?: string;
  txHash?: string;
  actions: LiveAction[];
  planActions?: GuardianAction[];
  planReasoning?: string;
  roundIntents?: Record<number, string>;
  draftSummary?: string;
  draftReasoning?: string;
};

export type PolicyReviewKind = "auto-invest-enable";

export type PolicyReviewData = {
  chainId: number;
  smartAccountAddress: Address;
  contracts: {
    usdc: Address;
    aavePool: Address;
    morphoVault: Address;
  };
  permissions: AutoInvestPermission[];
};

export type PolicyReview = {
  kind: PolicyReviewKind;
  stage: LiveStage;
  data: PolicyReviewData;
  request: AgentRequest;
  serviceUrl: string;
  error?: string;
};

export type AgentInstallReview = {
  kind: "agent-install";
  pluginId: string;
  serviceUrl: string;
  mallowMainWallet: Address;
  request: AgentRequest;
  stage: LiveStage;
  error?: string;
};

export type SignatureView =
  { kind: "message"; text: string } | { kind: "typedData"; typedData: unknown };

export type SignatureReview = {
  method: "personal_sign" | "eth_sign" | "eth_signTypedData" | "eth_signTypedData_v4";
  account: Address;
  chainId?: number;
  origin: { name: string; url: string; icon?: string };
  view: SignatureView;
  raw: unknown; // original JSON-RPC params, used for signing
};

export type QueueItem = {
  id: string;
  agent: string;
  proposedAt: string;
  proposedAtMs: number;
  intent: string;
  why: string;
  reasoning?: string; // Summarizer's structured analysis paragraph
  investigation?: string; // Analyzer's full plain-English read of the tx
  checkReasoning?: string; // Analyzer's step-by-step thinking ("How Guardian checked this")
  checks?: QueueCheck[]; // Deterministic "what Guardian did" log
  risk: RiskLevel;
  assetDiff: AssetDiffRow[];
  counterparty: Counterparty;
  impacts: string[];
  findings: QueueFinding[];
  sim: { gas: string; reverts: boolean };
  requiresTyping: boolean;
  state?: "approved" | "rejected";
  live?: LiveStatus;
  signatureReview?: SignatureReview;
  policyReview?: PolicyReview;
  agentInstall?: AgentInstallReview;
};
