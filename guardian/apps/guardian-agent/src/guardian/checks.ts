import type { Address, Hex } from "viem";
import type { GuardianCheck } from "../protocol";
import type { ToolCallRecord } from "./tools/types";

// Turn the analyzer's raw tool-call transcript into the deterministic
// "what Guardian actually did" log shown to the user. This is the strongest
// trust signal — it can't be hallucinated by the model because it's
// built from the tool call records the orchestrator captured.
export function buildChecks(toolCalls: ToolCallRecord[]): GuardianCheck[] {
  const out: GuardianCheck[] = [];
  for (const tc of toolCalls) {
    const built = describeToolCall(tc);
    if (built) out.push(built);
  }
  return out;
}

function describeToolCall(tc: ToolCallRecord): GuardianCheck | null {
  switch (tc.name) {
    case "decode_calldata":
      return describeDecode(tc);
    case "get_contract_info":
      return describeContract(tc);
    case "simulate_transaction":
      return describeSimulate(tc);
    case "lookup_sourcify_signature":
      return describeSourcify(tc);
    default:
      return null;
  }
}

function describeDecode(tc: ToolCallRecord): GuardianCheck {
  if (!tc.ok) {
    return {
      kind: "decode",
      ok: false,
      title: "Decode calldata",
      detail: errorText(tc.result, "Decode failed."),
    };
  }
  const r = tc.result as { selector?: Hex; signature?: string; source?: string; args?: unknown[] };
  if (r.selector === "0x" || r.source === "empty") {
    return {
      kind: "decode",
      ok: true,
      title: "Calldata: none",
      detail: "Plain value transfer — no function being invoked.",
    };
  }
  if (!r.signature) {
    return {
      kind: "decode",
      ok: false,
      title: `Selector ${r.selector ?? "?"} unresolved`,
      detail: "Neither cast's 4byte database nor Sourcify recognized this selector.",
    };
  }
  const sourceLabel = r.source === "sourcify" ? " (via Sourcify)" : "";
  const argsPreview =
    r.args && r.args.length > 0 ? ` Arguments: ${truncate(JSON.stringify(r.args), 140)}.` : "";
  return {
    kind: "decode",
    ok: true,
    title: `Decoded: ${r.signature}${sourceLabel}`,
    detail: `Selector ${r.selector}.${argsPreview}`,
  };
}

function describeContract(tc: ToolCallRecord): GuardianCheck {
  if (!tc.ok) {
    return {
      kind: "contract",
      ok: false,
      title: "Lookup target contract",
      detail: errorText(tc.result, "Contract lookup failed."),
    };
  }
  const r = tc.result as {
    kind?: "eoa" | "empty-or-undeployed" | "contract";
    address?: Address;
    verified?: boolean;
    name?: string;
    isProxy?: boolean;
    implementation?: Address;
    abiSelectors?: string[];
  };
  if (r.kind === "eoa") {
    return {
      kind: "contract",
      ok: true,
      title: `Address ${short(r.address)} is an EOA`,
      detail: "No contract code at this address — it can only receive value.",
    };
  }
  if (r.kind === "empty-or-undeployed") {
    return {
      kind: "contract",
      ok: false,
      title: `Address ${short(r.address)} has no deployed code`,
      detail:
        "No contract code is deployed here, but Guardian did not find an outgoing normal transaction proving this address is an EOA. It may be a fresh wallet, an undeployed contract address, or a mistaken address.",
    };
  }
  const name = r.name ?? "unnamed contract";
  const status = r.verified ? "verified on Etherscan" : "NOT verified on Etherscan";
  const proxyTail = r.isProxy
    ? r.implementation
      ? ` Proxy → implementation ${short(r.implementation)}.`
      : " Proxy contract (implementation unknown)."
    : "";
  const abiTail =
    r.abiSelectors && r.abiSelectors.length > 0
      ? ` ABI exposes ${r.abiSelectors.length} function${r.abiSelectors.length === 1 ? "" : "s"}.`
      : "";
  return {
    kind: "contract",
    ok: r.verified ?? false,
    title: `${short(r.address)} — ${name}`,
    detail: `${status}.${proxyTail}${abiTail}`,
  };
}

function describeSimulate(tc: ToolCallRecord): GuardianCheck {
  if (!tc.ok) {
    return {
      kind: "simulate",
      ok: false,
      title: "Simulate transaction (Anvil fork)",
      detail: errorText(tc.result, "Simulation could not run."),
    };
  }
  const r = tc.result as {
    success?: boolean;
    revertReason?: string;
    gasUsed?: string;
    trace?: unknown[];
    erc20Transfers?: unknown[];
    erc721Transfers?: unknown[];
    balanceDelta?: unknown[];
    storageDiffs?: number;
    truncated?: boolean;
  };
  if (r.success === false) {
    return {
      kind: "simulate",
      ok: false,
      title: "Simulation reverted",
      detail: r.revertReason
        ? `Anvil rejected the transaction: ${r.revertReason}. Signing it would burn gas with no state change.`
        : "Anvil rejected the transaction. Signing it would burn gas with no state change.",
    };
  }
  const gas = r.gasUsed ? formatGas(r.gasUsed) : "unknown gas";
  const counts: string[] = [];
  if (r.trace?.length)
    counts.push(
      `${r.trace.length} call${r.trace.length === 1 ? "" : "s"}${r.truncated ? "+" : ""}`,
    );
  if (r.erc20Transfers?.length)
    counts.push(
      `${r.erc20Transfers.length} ERC-20 transfer${r.erc20Transfers.length === 1 ? "" : "s"}`,
    );
  if (r.erc721Transfers?.length)
    counts.push(
      `${r.erc721Transfers.length} NFT transfer${r.erc721Transfers.length === 1 ? "" : "s"}`,
    );
  if (r.balanceDelta?.length)
    counts.push(
      `${r.balanceDelta.length} ETH balance change${r.balanceDelta.length === 1 ? "" : "s"}`,
    );
  if (r.storageDiffs)
    counts.push(`${r.storageDiffs} storage write${r.storageDiffs === 1 ? "" : "s"}`);
  const detail =
    counts.length > 0
      ? `Used ${gas}. Trace contains ${counts.join(", ")}.`
      : `Used ${gas}. No state changes observed.`;
  return {
    kind: "simulate",
    ok: true,
    title: "Simulated against Anvil fork",
    detail,
  };
}

function describeSourcify(tc: ToolCallRecord): GuardianCheck {
  if (!tc.ok) {
    return {
      kind: "signature",
      ok: false,
      title: "Sourcify signature lookup",
      detail: errorText(tc.result, "Sourcify request failed."),
    };
  }
  const r = tc.result as { selector?: Hex; signatures?: string[] };
  const sigs = r.signatures ?? [];
  if (sigs.length === 0) {
    return {
      kind: "signature",
      ok: false,
      title: `Selector ${r.selector ?? "?"} unknown to Sourcify`,
      detail: "No public signature matches this selector.",
    };
  }
  const head = sigs.slice(0, 3).join(", ");
  const more = sigs.length > 3 ? ` (+${sigs.length - 3} more)` : "";
  return {
    kind: "signature",
    ok: true,
    title: `Resolved ${r.selector}`,
    detail: `Candidate signatures: ${head}${more}.`,
  };
}

function errorText(result: unknown, fallback: string): string {
  if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
    const err = (result as { error?: unknown }).error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback;
}

function short(a: Address | undefined): string {
  if (!a) return "<unknown>";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function formatGas(s: string): string {
  try {
    const n = BigInt(s);
    if (n < 1000n) return `${n.toString()} gas`;
    const k = Number(n / 1000n);
    return `${k.toLocaleString()}k gas`;
  } catch {
    return `${s} gas`;
  }
}
