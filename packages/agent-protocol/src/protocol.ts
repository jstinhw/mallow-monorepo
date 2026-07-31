import type { Hex, Address } from "viem";

export type AgentRequestAccount =
  | { address: Address; type: "eoa"; data: Hex }
  | { address: Address; type: "smart_account"; data: Hex };

// Two action shapes the service can ask Mallow to perform.
//   - "tx": broadcast a regular transaction. Mallow returns the txnHash in
//     /install.
//   - "sig": sign something with one of the user's accounts. Mallow returns the
//     signature (hex) in /install. The payload is either a raw message
//     (personal_sign) or EIP-712 typed data. Mallow signs the bytes verbatim —
//     it never has to understand what the signature authorizes, so a service can
//     ask for, say, a ZeroDev session-account approval without leaking any of
//     that implementation into the wallet.
export type AgentRequestTxAction = {
  kind: "tx";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
};

// Minimal EIP-712 envelope carried over the wire. Kept structural (not viem's
// TypedDataDefinition) so the protocol package stays free of signing-library
// types; the wallet hands it straight to `account.signTypedData`.
export type Eip712TypedData = {
  domain: Record<string, unknown>;
  types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type AgentRequestSigPayload =
  { type: "message"; message: Hex } | { type: "typedData"; typedData: Eip712TypedData };

export type AgentRequestSigAction = {
  kind: "sig";
  chainId: number;
  // The account Mallow must sign with (e.g. the user's main wallet).
  signer: Address;
  payload: AgentRequestSigPayload;
};

export type AgentRequestAction = AgentRequestTxAction | AgentRequestSigAction;

export type AgentRequest = {
  name: string;
  description: string;
  accounts: AgentRequestAccount[];
  actions: AgentRequestAction[];
};

// /install body. One result per action, in the same order Mallow processed
// them. `kind` echoes the action it answers: "tx" → `data` is a broadcast
// txnHash; "sig" → `data` is the signature Mallow produced. `kind` is optional
// and defaults to "tx" so older tx-only callers keep parsing.
export type AgentInstallTxnResult = {
  chainId: number;
  kind?: "tx" | "sig";
  data: string;
};

export type AgentInstallBody = {
  account: Address;
  txns: AgentInstallTxnResult[];
};

export type AgentInstallResponse = {
  agentId: string;
};
