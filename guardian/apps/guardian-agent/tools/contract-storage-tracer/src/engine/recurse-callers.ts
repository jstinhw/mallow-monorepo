import type { Address } from "viem";
import type { Boundedness } from "../types/constraint";
import type {
  AddressReport,
  CallChain,
  CompressedContract,
  UnboundedFrontier,
} from "../types/report";
import type { SargEdge, SargNode } from "../types/sarg";
import type { ContractInfo, VerifiedContract } from "../acquire/contract";
import { analyzeCallers, type CallerRoute, type TargetSpec } from "../analyze/anchor-analyzer";
import { sliceByCallClosure, type CallClosureSlice } from "../analyze/slice";
import { bookTag, logCallTree, provLabel, tagSuffix } from "./format";
import { toAddressReport, toCompressed } from "./report-mappers";
import type { FrontierCaller } from "./classify-touchers";
import type { AnchorInstance } from "./resolve-seed";
import type { TraceSession } from "./session";

/** SafeERC20-style wrappers of a token member, with the extra leading `token` arg shifting `from`. */
const WRAPPER_ALIASES: Record<
  string,
  readonly { readonly member: string; readonly argShift: number }[]
> = {
  transferFrom: [{ member: "safeTransferFrom", argShift: 1 }],
  approve: [
    { member: "safeApprove", argShift: 1 },
    { member: "forceApprove", argShift: 1 },
  ],
};

/** The token members that constitute "reaching this anchor" when following a caller, with the arg
 *  index that carries the anchor key in each (derived from the toucher binding, not a fixed table). */
function targetSpecs(tokenFn: string, argIndex: number): readonly TargetSpec[] {
  return [
    { member: tokenFn, argIndex },
    ...(WRAPPER_ALIASES[tokenFn] ?? []).map((a) => ({
      member: a.member,
      argIndex: argIndex + a.argShift,
    })),
  ];
}

interface WorkItem extends FrontierCaller {
  readonly depth: number;
}

/** What one visited caller contributes to the report, plus the next frontier items. */
interface VisitDelta {
  readonly chains: readonly CallChain[];
  readonly nodes: readonly SargNode[];
  readonly edges: readonly SargEdge[];
  readonly unbounded: readonly UnboundedFrontier[];
  readonly reasons: readonly string[];
  readonly compressed: readonly CompressedContract[];
  readonly enqueue: readonly WorkItem[];
}

const EMPTY_DELTA: VisitDelta = {
  chains: [],
  nodes: [],
  edges: [],
  unbounded: [],
  reasons: [],
  compressed: [],
  enqueue: [],
};

function mergeDeltas(deltas: readonly VisitDelta[]): VisitDelta {
  return {
    chains: deltas.flatMap((d) => d.chains),
    nodes: deltas.flatMap((d) => d.nodes),
    edges: deltas.flatMap((d) => d.edges),
    unbounded: deltas.flatMap((d) => d.unbounded),
    reasons: deltas.flatMap((d) => d.reasons),
    compressed: deltas.flatMap((d) => d.compressed),
    enqueue: deltas.flatMap((d) => d.enqueue),
  };
}

/** Everything the recursion produces; the caller merges it with the token-side result. */
export interface RecursionResult {
  readonly chains: readonly CallChain[];
  readonly nodes: readonly SargNode[];
  readonly edges: readonly SargEdge[];
  readonly unbounded: readonly UnboundedFrontier[];
  readonly reasons: readonly string[];
  readonly compressed: readonly CompressedContract[];
  /** Per visited caller (lowercased address): report record + log-only book tag. */
  readonly addresses: ReadonlyMap<string, AddressReport>;
  readonly bookTags: ReadonlyMap<string, string>;
  /** Chains/unbounded bucketed by the anchor they belong to (index into ResolvedSeed.anchors). */
  readonly perAnchor: ReadonlyMap<
    number,
    { readonly chains: readonly CallChain[]; readonly unbounded: readonly UnboundedFrontier[] }
  >;
}

/** A caller that cannot be descended into: EOA (terminal), undetermined, or unverified. */
function visitTerminal(
  session: TraceSession,
  item: WorkItem,
  info: Exclude<ContractInfo, VerifiedContract>,
): VisitDelta {
  const { log } = session;
  if (info.kind === "eoa") {
    log.note(`EOA${info.delegation ? " (7702 delegated)" : ""} → terminal actor (no new address)`);
    return EMPTY_DELTA;
  }
  if (info.kind === "undetermined") {
    const reason = `${item.addr} has no code and no sent txs — possibly an undeployed/counterfactual contract that could later reach this anchor`;
    log.note("undetermined → flagged (possible undeployed contract)");
    return { ...EMPTY_DELTA, unbounded: [{ node: item.addr, reason }], reasons: [reason] };
  }
  log.note(`unverified${tagSuffix(info)} → cannot descend`);
  return {
    ...EMPTY_DELTA,
    reasons: [`caller ${item.addr} is an unverified contract (source unavailable)`],
  };
}

/** One entrypoint route through a caller: log it, edge it, and classify who can drive it at the
 *  key-holder's slot (key-holder-pinned → recurse; caller-supplied → unbounded; derived → opaque). */
function routeDelta(
  session: TraceSession,
  target: VerifiedContract,
  anchor: AnchorInstance,
  item: WorkItem,
  info: VerifiedContract,
  slice: CallClosureSlice,
  tokenSel: string,
  r: CallerRoute,
  position: string,
): VisitDelta {
  const { chainId, log } = session;
  const nid = { chainId, address: item.addr, selector: r.selector };
  const keyHolder = item.binding ? anchor.concreteKeys[item.binding.keyIndex] : undefined;

  const head =
    r.constraint.kind === "caller-is-owner"
      ? keyHolder
        ? "key-holder"
        : "<key-holder>"
      : r.constraint.kind === "unbounded"
        ? "any caller"
        : "opaque caller";
  log.note(
    `${position} ${head} → ${r.contract}.${r.functionName} (key-arg=${provLabel(r.fromProvenance)})`,
  );
  const closure = slice.closures.find((c) => c.entry === `${r.contract}.${r.functionName}`);
  if (closure) logCallTree(log, closure.tree, `${target.contractName}.${item.tokenFn}`);

  const edge: SargEdge = {
    kind: "external-call",
    from: nid,
    to: { chainId, address: target.address, selector: tokenSel },
    callsite: `${r.member}(key-arg=${provLabel(r.fromProvenance)})`,
    targetResolution: "polymorphic",
    provenance: "verified",
  };

  if (r.constraint.kind === "caller-is-owner") {
    const holderLabel = keyHolder ?? "<key-holder>";
    const b: Boundedness = {
      kind: "singleton",
      callers: keyHolder ? [keyHolder as Address] : [],
      guards: [],
    };
    return {
      ...EMPTY_DELTA,
      edges: [edge],
      nodes: [
        {
          id: nid,
          codehash: info.codehash,
          functionName: r.functionName,
          touches: [],
          boundedness: b,
          verified: true,
        },
      ],
      chains: [
        {
          path: [
            holderLabel,
            `${info.contractName}.${r.functionName}`,
            `${target.contractName}.${item.tokenFn}`,
          ],
          op: "read-write",
          boundedness: b,
          provenance: "verified",
        },
      ],
      enqueue:
        keyHolder && item.depth < session.bounds.maxDepth
          ? [
              {
                addr: keyHolder as Address,
                tokenFn: item.tokenFn,
                depth: item.depth + 1,
                via: `${info.contractName}.${r.functionName} → ${item.via}`,
                anchorIndex: item.anchorIndex,
                ...(item.binding ? { binding: item.binding } : {}),
              },
            ]
          : [],
    };
  }
  if (r.constraint.kind === "unbounded") {
    const b: Boundedness = { kind: "unbounded", reason: r.constraint.reason, guards: [] };
    return {
      ...EMPTY_DELTA,
      edges: [edge],
      nodes: [
        {
          id: nid,
          codehash: info.codehash,
          functionName: r.functionName,
          touches: [],
          boundedness: b,
          verified: true,
        },
      ],
      unbounded: [{ node: `${info.contractName}.${r.functionName}`, reason: r.constraint.reason }],
      reasons: [`unbounded: ${info.contractName}.${r.functionName} — ${r.constraint.reason}`],
      chains: [
        {
          path: [
            "<any caller>",
            `${info.contractName}.${r.functionName}`,
            `${target.contractName}.${item.tokenFn}`,
          ],
          op: "read-write",
          boundedness: b,
          provenance: "verified",
        },
      ],
    };
  }
  const b: Boundedness = {
    kind: "role-set",
    roleVar: r.constraint.note,
    enumeration: "trace",
    guards: [],
  };
  return {
    ...EMPTY_DELTA,
    edges: [edge],
    nodes: [
      {
        id: nid,
        codehash: info.codehash,
        functionName: r.functionName,
        touches: [],
        boundedness: b,
        verified: true,
      },
    ],
    reasons: [
      `opaque: ${info.contractName}.${r.functionName} — ${r.constraint.note} (needs dynamic/deeper analysis)`,
    ],
    chains: [
      {
        path: [
          "<opaque caller>",
          `${info.contractName}.${r.functionName}`,
          `${target.contractName}.${item.tokenFn}`,
        ],
        op: "read-write",
        boundedness: b,
        provenance: "verified",
      },
    ],
  };
}

/** A verified contract caller: find its entrypoints that reach the token function, slice it by
 *  call-closure, and classify each route's caller constraint. */
function visitContract(
  session: TraceSession,
  target: VerifiedContract,
  anchors: readonly AnchorInstance[],
  item: WorkItem,
  info: VerifiedContract,
): VisitDelta {
  const { log } = session;
  const anchor = anchors[item.anchorIndex]!;
  const specs = targetSpecs(item.tokenFn, item.binding?.argIndex ?? 0);

  const reachers = analyzeCallers(info.compiled, specs);
  if (reachers.length === 0) {
    log.note(`${info.contractName} → no ${item.tokenFn} call-sites`);
    return {
      ...EMPTY_DELTA,
      reasons: [`${info.contractName} (${item.addr}) has no ${item.tokenFn} call-sites`],
    };
  }
  log.note(`${info.contractName} → ${reachers.length} entrypoints reach ${item.tokenFn}`);

  const slice = sliceByCallClosure(
    info.compiled,
    reachers.map((r) => r.functionName),
    specs.map((s) => s.member),
  );
  const tokenSel =
    anchor.analysis.touchers.find((t) => t.functionName === item.tokenFn)?.selector ?? "0x";
  const routes = reachers.map((r, i) =>
    routeDelta(
      session,
      target,
      anchor,
      item,
      info,
      slice,
      tokenSel,
      r,
      `[${i + 1}/${reachers.length}]`,
    ),
  );
  return mergeDeltas([
    { ...EMPTY_DELTA, compressed: [toCompressed(item.addr, info.codehash, slice)] },
    ...routes,
  ]);
}

/**
 * Backward recursion (worklist), shared across all of the seed's anchors. EOAs are terminal
 * actors. For a contract caller we resolve, per entrypoint, the provenance of the anchor-key
 * argument it passes to the token member: `msg.sender` pins the caller back to the key-holder
 * (recurse — the key-holder is the terminal actor); a caller-supplied key arg is a permissionless
 * action on the key-holder's slot (flagged). The frontier closes when no new address appears.
 */
export async function recurseCallers(
  session: TraceSession,
  target: VerifiedContract,
  anchors: readonly AnchorInstance[],
  frontier: readonly FrontierCaller[],
): Promise<RecursionResult> {
  const { log } = session;

  const queue: WorkItem[] = frontier.map((f) => ({ ...f, depth: 1 }));
  const visited = new Set<string>();
  const addresses = new Map<string, AddressReport>();
  const bookTags = new Map<string, string>();
  const perAnchor = new Map<number, { chains: CallChain[]; unbounded: UnboundedFrontier[] }>();
  anchors.forEach((_, i) => perAnchor.set(i, { chains: [], unbounded: [] }));
  const deltas: VisitDelta[] = [];
  log.step(`backward recursion (worklist) · frontier ${queue.length}`);

  while (queue.length > 0 && visited.size < session.bounds.maxAddresses) {
    const item = queue.shift()!;
    const key = `${item.addr.toLowerCase()}:${item.tokenFn}:${item.anchorIndex}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const info = await session.contracts(item.addr);
    addresses.set(item.addr.toLowerCase(), toAddressReport(info));
    bookTags.set(item.addr.toLowerCase(), bookTag(info));
    log.sub(
      `visit caller ${item.addr} → ${item.via} · depth ${item.depth} · ${info.kind}${info.kind === "contract" ? "" : tagSuffix(info)}`,
    );

    const delta =
      info.kind === "contract"
        ? visitContract(session, target, anchors, item, info)
        : visitTerminal(session, item, info);
    deltas.push(delta);
    const bucket = perAnchor.get(item.anchorIndex)!;
    bucket.chains.push(...delta.chains);
    bucket.unbounded.push(...delta.unbounded);
    queue.push(...delta.enqueue);
  }

  const { chains, nodes, edges, unbounded, reasons, compressed } = mergeDeltas(deltas);
  return { chains, nodes, edges, unbounded, reasons, compressed, addresses, bookTags, perAnchor };
}
