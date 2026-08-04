import { encodeFunctionData, hexToBigInt, pad, type Address, type Hex } from "viem";
import type { Anchor, KeyProvenance, MappingKey } from "../types/anchor";
import type { Seed } from "../schemas/seed";
import type { VerifiedContract } from "../acquire/contract";
import { decodeSeedCall, type DecodedCall } from "../acquire/decode";
import type { SlotObservation, StorageObservation } from "../acquire/observe";
import type { StorageLayoutItem } from "../analyze/compile";
import { analyzeAnchor, type AnchorAnalysis } from "../analyze/anchor-analyzer";
import { attributeSlots, type AttributedSlot, type PathSegment } from "../analyze/attribute";
import { enumerateKeyCandidates } from "../analyze/key-candidates";
import { mappingValueSlot } from "../analyze/slot";
import { analyzeWrites } from "../analyze/write-scan";
import type { TraceSession } from "./session";

export type AnchorVerification = "observed-write" | "prestate-match" | "static-hypothesis";

/** One concrete storage variable the seed touches, with everything the later phases need. */
export interface AnchorInstance {
  readonly item: StorageLayoutItem;
  readonly anchor: Anchor;
  readonly analysis: AnchorAnalysis;
  readonly concreteKeys: readonly (string | undefined)[];
  readonly path: readonly PathSegment[];
  readonly pathLabel: string;
  readonly access: "write" | "touch" | "static-write";
  readonly verification: AnchorVerification;
  readonly observedSlot?: Hex;
}

export interface ResolvedSeed {
  readonly target: VerifiedContract;
  readonly call: DecodedCall;
  readonly observation: StorageObservation;
  readonly anchors: readonly AnchorInstance[];
  readonly unattributed: readonly SlotObservation[];
  readonly slotVerified: boolean;
}

const ALLOWANCE_TYPE = "t_mapping(t_address,t_mapping(t_address,t_uint256))";
const ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ── path/key extraction ──────────────────────────────────────────────────────────────────

function keyPathOf(path: readonly PathSegment[]): readonly MappingKey[] {
  return path
    .filter((s): s is Extract<PathSegment, { kind: "mapping-key" }> => s.kind === "mapping-key")
    .map((s) => ({ provenance: s.candidate.origin, concrete: s.candidate.raw }));
}

function elementPathOf(path: readonly PathSegment[]): readonly string[] {
  const out: string[] = [];
  for (const s of path) {
    if (s.kind === "struct-member") out.push(s.member);
    else if (s.kind === "array-index") out.push(`[${s.index}]`);
    else if (s.kind === "array-length") out.push("length");
  }
  return out;
}

function renderPath(variable: string, path: readonly PathSegment[]): string {
  let out = variable;
  for (const s of path) {
    if (s.kind === "mapping-key") out += `[${short(s.candidate.raw)}]`;
    else if (s.kind === "struct-member") out += `.${s.member}`;
    else if (s.kind === "array-index") out += `[${s.index}]`;
    else if (s.kind === "array-length") out += ".length";
  }
  return out;
}

const short = (h: string): string => (h.length > 12 ? `${h.slice(0, 8)}…` : h);

function buildAnchor(
  target: VerifiedContract,
  item: StorageLayoutItem,
  valueType: string,
  path: readonly PathSegment[],
): Anchor {
  const keyPath = keyPathOf(path);
  const elementPath = elementPathOf(path);
  return {
    codehash: target.codehash,
    baseSlot: item.slot,
    variable: item.label,
    keyPath,
    valueType,
    ...(elementPath.length ? { elementPath } : {}),
  };
}

// ── dynamic path: anchors from observed writes ─────────────────────────────────────────────

/** True when the attributed slot represents a write the seed makes (vs. a read-only touch). */
function isWriteAnchor(
  attr: AttributedSlot,
  source: StorageObservation["source"],
  writtenVars: ReadonlySet<string>,
): boolean {
  if (source === "prestate-diff") return attr.observed.access === "write";
  if (source === "access-list") return writtenVars.has(attr.item.label);
  return false;
}

function instanceFromAttributed(target: VerifiedContract, attr: AttributedSlot): AnchorInstance {
  const anchor = buildAnchor(target, attr.item, attr.valueType, attr.path);
  const concreteKeys = anchor.keyPath.map((k) => k.concrete);
  const analysis = analyzeAnchor(
    target.compiled,
    attr.item.label,
    attr.item.slot,
    attr.item.type,
    concreteKeys,
  );
  return {
    item: attr.item,
    anchor,
    analysis,
    concreteKeys,
    path: attr.path,
    pathLabel: renderPath(attr.item.label, attr.path),
    access: "write",
    verification: "observed-write",
    observedSlot: attr.observed.slot,
  };
}

// ── static path: anchors synthesized from the write scan ────────────────────────────────────

function concretize(prov: KeyProvenance, seed: Seed, decoded: DecodedCall): string | undefined {
  if (prov.kind === "msg.sender" || prov.kind === "tx.origin") return seed.from.toLowerCase();
  if (prov.kind === "constant") return prov.value;
  if (prov.kind === "arg") {
    const raw = decoded.args[prov.index];
    if (typeof raw === "string") return raw.toLowerCase();
    if (typeof raw === "bigint" || typeof raw === "number") {
      const v = BigInt(raw);
      // Signed values are stored two's-complement; keep the key valid 256-bit hex.
      return `0x${(v < 0n ? BigInt.asUintN(256, v) : v).toString(16)}`;
    }
  }
  return undefined;
}

function staticInstance(
  target: VerifiedContract,
  item: StorageLayoutItem,
  keys: readonly KeyProvenance[],
  seed: Seed,
  decoded: DecodedCall,
): AnchorInstance | undefined {
  const concreteKeys = keys.map((k) => concretize(k, seed, decoded));
  const keyPath: readonly MappingKey[] = keys.map((provenance, i) => ({
    provenance,
    ...(concreteKeys[i] !== undefined ? { concrete: concreteKeys[i]! } : {}),
  }));
  const anchor: Anchor = {
    codehash: target.codehash,
    baseSlot: item.slot,
    variable: item.label,
    keyPath,
    valueType: item.type,
  };
  const analysis = analyzeAnchor(target.compiled, item.label, item.slot, item.type, concreteKeys);
  const observedSlot =
    keyPath.length > 0 && concreteKeys.every((k) => k !== undefined)
      ? mappingValueSlot(
          BigInt(item.slot),
          concreteKeys.map((k) => pad(k as Hex, { size: 32 })),
        )
      : (pad(`0x${BigInt(item.slot).toString(16)}`, { size: 32 }) as Hex);
  return {
    item,
    anchor,
    analysis,
    concreteKeys,
    path: [],
    pathLabel: renderPath(
      item.label,
      keyPath.map((k) => ({
        kind: "mapping-key",
        encoded: "0x",
        candidate: { raw: (k.concrete ?? "0x") as Hex, label: "", origin: k.provenance },
      })),
    ),
    access: "static-write",
    verification: "static-hypothesis",
    observedSlot,
  };
}

function syntheticAnchors(
  target: VerifiedContract,
  seed: Seed,
  decoded: DecodedCall,
): readonly AnchorInstance[] {
  if (decoded.functionName === "unknown") return [];
  const writes = analyzeWrites(target.compiled, decoded.functionName, decoded.args.length);
  const byLabel = new Map(target.compiled.storage.map((s) => [s.label, s]));
  const out: AnchorInstance[] = [];
  const seen = new Set<string>();
  for (const w of writes) {
    const item = byLabel.get(w.varName);
    if (!item) continue;
    const inst = staticInstance(target, item, w.keys, seed, decoded);
    if (!inst) continue;
    const dedupeKey = `${w.varName}|${inst.concreteKeys.join(",")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(inst);
  }
  return out;
}

// ── on-chain verification (best effort, pinned) ─────────────────────────────────────────────

/** Reinforces static allowance anchors with the classic on-chain `allowance()` cross-check. */
async function crossCheckAllowance(
  session: TraceSession,
  target: VerifiedContract,
  ai: AnchorInstance,
): Promise<AnchorVerification> {
  if (ai.item.type !== ALLOWANCE_TYPE || ai.concreteKeys.length !== 2) return ai.verification;
  const [owner, spender] = ai.concreteKeys;
  if (!owner || !spender || !ai.observedSlot) return ai.verification;
  try {
    const raw =
      (await session.publicClient.getStorageAt({
        address: target.address,
        slot: ai.observedSlot,
        blockNumber: session.blockNumber,
      })) ?? "0x";
    const fromStorage = hexToBigInt(raw === "0x" ? "0x0" : raw);
    const { data } = await session.publicClient.call({
      to: target.address,
      data: encodeFunctionData({
        abi: ALLOWANCE_ABI,
        functionName: "allowance",
        args: [owner as Address, spender as Address],
      }),
      blockNumber: session.blockNumber,
    });
    return fromStorage === hexToBigInt(data ?? "0x") ? "prestate-match" : ai.verification;
  } catch {
    return ai.verification;
  }
}

// ── entrypoint ──────────────────────────────────────────────────────────────────────────────

/**
 * Seed → concrete anchors. Loads and decodes the seed call, observes the storage it writes
 * (dynamic tiers) or scans the source for writes (static fallback), attributes each written slot
 * to a layout variable + concrete key path, and analyzes who touches it. `approve` becomes one
 * instance of this general path: its single allowance write is the sole anchor.
 */
export async function resolveSeed(
  session: TraceSession,
  seed: Seed,
  opts: { readonly anchorFilter?: string } = {},
): Promise<ResolvedSeed> {
  const { log } = session;

  log.step(`load target ${seed.to} · resolve proxy → impl → compile`);
  const target = await session.contracts(seed.to as Address);
  if (target.kind !== "contract")
    throw new Error(`target ${seed.to} is ${target.kind}, expected a verified contract`);
  log.sub(
    `${target.contractName}${target.implementation ? ` (impl ${target.implementation})` : ""} · ${target.compiled.storage.length} storage vars`,
  );

  const call = await decodeSeedCall(seed.data as Hex, target.compiled.abi, log);
  log.step(
    `decode calldata · ${call.functionName}${call.args.length ? `(${call.args.length} args)` : ""} · via ${call.source}`,
  );

  log.step(`observe storage · simulate at pinned block`);
  const observation = await session.observer.observe(
    { from: seed.from as Address, to: seed.to as Address, data: seed.data as Hex },
    session.blockNumber,
  );
  log.sub(
    `source ${observation.source}${observation.reverted ? " · call reverts" : ""} · ${observation.slots.length} slots touched`,
  );

  const candidates = enumerateKeyCandidates(seed, call);
  const readLength = async (slot: Hex): Promise<Hex | undefined> =>
    (await session.publicClient.getStorageAt({
      address: seed.to as Address,
      slot,
      blockNumber: session.blockNumber,
    })) ?? undefined;

  let anchors: readonly AnchorInstance[] = [];
  let unattributed: readonly SlotObservation[] = [];

  if (observation.slots.length > 0) {
    const forTarget = observation.slots.filter(
      (o) =>
        o.address.toLowerCase() === seed.to.toLowerCase() ||
        (target.implementation && o.address.toLowerCase() === target.implementation.toLowerCase()),
    );
    const result = await attributeSlots(
      target.compiled.storage,
      target.compiled.storageTypes,
      forTarget,
      candidates,
      readLength,
    );
    unattributed = result.unattributed;
    const writtenVars = new Set(
      analyzeWrites(
        target.compiled,
        call.functionName === "unknown" ? "" : call.functionName,
        call.args.length,
      ).map((w) => w.varName),
    );
    const writeSlots = result.attributed.filter((a) =>
      isWriteAnchor(a, observation.source, writtenVars),
    );
    const grouped = new Map<string, AttributedSlot>();
    for (const a of writeSlots) {
      const key = `${a.item.label}|${keyPathOf(a.path)
        .map((k) => k.concrete)
        .join(",")}|${elementPathOf(a.path).join(".")}`;
      if (!grouped.has(key)) grouped.set(key, a);
    }
    anchors = [...grouped.values()].map((a) => instanceFromAttributed(target, a));
  }

  // Static fallback: no dynamic observation, or dynamic saw no writes we could attribute.
  if (anchors.length === 0) {
    anchors = await Promise.all(
      syntheticAnchors(target, seed, call).map(async (ai) => ({
        ...ai,
        verification: await crossCheckAllowance(session, target, ai),
      })),
    );
  }

  if (opts.anchorFilter) {
    const filtered = anchors.filter((a) => a.item.label === opts.anchorFilter);
    if (filtered.length === 0) {
      const available = [...new Set(anchors.map((a) => a.item.label))].join(", ") || "(none)";
      throw new Error(`--anchor '${opts.anchorFilter}' not among written variables: ${available}`);
    }
    anchors = filtered;
  }

  log.step(`anchors · ${anchors.length} written variable${anchors.length === 1 ? "" : "s"}`);
  for (const a of anchors)
    log.sub(
      `${a.pathLabel} @ slot ${a.item.slot} · ${a.analysis.touchers.length} touchers · ${a.verification}`,
    );

  const slotVerified = anchors.some((a) => a.verification !== "static-hypothesis");
  return { target, call, observation, anchors, unattributed, slotVerified };
}
