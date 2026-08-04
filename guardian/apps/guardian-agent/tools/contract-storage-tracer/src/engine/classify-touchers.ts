import type { Address } from "viem";
import type { KeyProvenance } from "../types/anchor";
import type { Boundedness } from "../types/constraint";
import type { CallChain, UnboundedFrontier } from "../types/report";
import type { SargNode } from "../types/sarg";
import type { VerifiedContract } from "../acquire/contract";
import { boundLabel } from "./format";
import type { AnchorInstance } from "./resolve-seed";
import type { TraceSession } from "./session";

/** A caller the backward recursion must visit, discovered from a bounded toucher. */
export interface FrontierCaller {
  readonly addr: Address;
  /** The token function this caller is authorized to reach (e.g. `transferFrom`). */
  readonly tokenFn: string;
  /** The callee chain this address is a caller of — display only, so the log reads
   *  "caller → route → token fn" instead of a bare address. */
  readonly via: string;
  /** Which anchor this frontier belongs to (index into ResolvedSeed.anchors). */
  readonly anchorIndex: number;
  /** The anchor key bound to a token-fn argument: which key position, and which arg carries it.
   *  This is what the recursion follows to pin a caller back to the key-holder. */
  readonly binding?: { readonly keyIndex: number; readonly argIndex: number };
}

/** Token-side result for one anchor: chains/nodes per toucher, plus the initial frontier. */
export interface TokenClassification {
  readonly chains: readonly CallChain[];
  readonly nodes: readonly SargNode[];
  readonly unbounded: readonly UnboundedFrontier[];
  readonly reasons: readonly string[];
  readonly frontier: readonly FrontierCaller[];
}

function singletonCallers(b: Boundedness): readonly Address[] {
  if (b.kind === "singleton") return b.callers;
  if (b.kind === "fixed-onchain") return [b.caller];
  return [];
}

/** The anchor key a token function binds to one of its arguments (the "pull" account). */
function bindingOf(
  keys: readonly KeyProvenance[],
): { readonly keyIndex: number; readonly argIndex: number } | undefined {
  const keyIndex = keys.findIndex((k) => k.kind === "arg");
  const k = keyIndex >= 0 ? keys[keyIndex] : undefined;
  return k?.kind === "arg" ? { keyIndex, argIndex: k.index } : undefined;
}

/**
 * Classifies every anchor toucher's caller boundedness: singleton callers become chains and
 * frontier entries (deduped by address), unbounded touchers are flagged (never expanded), and
 * role-set touchers are recorded as a partial-coverage reason. Anchor-shape-agnostic: it reads
 * the anchor instance's precomputed toucher analysis.
 */
export function classifyTouchers(
  session: TraceSession,
  target: VerifiedContract,
  ai: AnchorInstance,
  anchorIndex: number,
): TokenClassification {
  const { chainId, log } = session;
  const { analysis, item } = ai;
  log.step(`classify caller boundedness · ${ai.pathLabel} · ${analysis.touchers.length} touchers`);

  const chains: CallChain[] = [];
  const nodes: SargNode[] = [];
  const unbounded: UnboundedFrontier[] = [];
  const reasons: string[] = [];
  const frontier = new Map<string, FrontierCaller>();

  for (const t of analysis.touchers) {
    log.sub(`${t.functionName} [${t.op}] → ${boundLabel(t.boundedness)}`);
    nodes.push({
      id: { chainId, address: target.address, selector: t.selector },
      codehash: target.codehash,
      functionName: t.functionName,
      touches: [{ slot: item.slot, access: t.op }],
      boundedness: t.boundedness,
      verified: true,
    });
    const binding = bindingOf(t.keys);
    for (const caller of singletonCallers(t.boundedness)) {
      chains.push({
        path: [caller, `${target.contractName}.${t.functionName}`],
        op: t.op,
        boundedness: t.boundedness,
        provenance: "verified",
      });
      // Key by (caller, tokenFn): the same caller may reach the anchor through several token
      // functions (approve / increaseAllowance / …), each a distinct route to explore.
      frontier.set(`${caller.toLowerCase()}:${t.functionName}`, {
        addr: caller,
        tokenFn: t.functionName,
        via: `${target.contractName}.${t.functionName}`,
        anchorIndex,
        ...(binding ? { binding } : {}),
      });
    }
    if (t.boundedness.kind === "unbounded") {
      unbounded.push({
        node: `${target.contractName}.${t.functionName}`,
        reason: t.boundedness.reason,
      });
      reasons.push(`unbounded: ${target.contractName}.${t.functionName} (${t.op})`);
      chains.push({
        path: ["<any caller>", `${target.contractName}.${t.functionName}`],
        op: t.op,
        boundedness: t.boundedness,
        provenance: "verified",
      });
    }
    if (t.boundedness.kind === "role-set")
      reasons.push(
        `role-set: ${target.contractName}.${t.functionName} via ${t.boundedness.roleVar} (enumerate off-chain)`,
      );
  }

  return { chains, nodes, unbounded, reasons, frontier: [...frontier.values()] };
}
