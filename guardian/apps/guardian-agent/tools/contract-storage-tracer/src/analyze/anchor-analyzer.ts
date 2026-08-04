import { toFunctionSelector, type AbiFunction } from "viem";
import type { Access } from "../types/common";
import type { KeyProvenance } from "../types/anchor";
import type { Boundedness, Guard } from "../types/constraint";
import type { Compiled } from "./compile";
import {
  baseVarId,
  functionParams,
  indexAst,
  resolveAccessChain,
  resolveCallee,
  type AstIndex,
  type AstNode,
} from "./ast";

export interface Toucher {
  readonly functionName: string;
  readonly selector: string;
  readonly op: Access;
  readonly boundedness: Boundedness;
  /** Representative key provenance of the anchor access (drives the recursion binding). */
  readonly keys: readonly KeyProvenance[];
}

export interface AnchorAnalysis {
  readonly contractName: string;
  readonly anchorVar: string;
  readonly baseSlot: string;
  readonly anchorType: string;
  readonly touchers: readonly Toucher[];
}

export type ArgProv = ReadonlyMap<number, KeyProvenance>;

/** Resolves the provenance of a key/argument expression in the current arg context. */
export function resolveExpr(expr: AstNode | undefined, argProv: ArgProv): KeyProvenance {
  if (!expr) return { kind: "unknown" };
  if (expr.nodeType === "MemberAccess") {
    const base = expr.expression as AstNode | undefined;
    if (base?.nodeType === "Identifier" && base.name === "msg" && expr.memberName === "sender")
      return { kind: "msg.sender" };
    if (base?.nodeType === "Identifier" && base.name === "tx" && expr.memberName === "origin")
      return { kind: "tx.origin" };
    return { kind: "derived", note: `${base?.name ?? "?"}.${String(expr.memberName)}` };
  }
  if (expr.nodeType === "Identifier") {
    const ref = expr.referencedDeclaration as number | undefined;
    if (ref !== undefined && argProv.has(ref)) return argProv.get(ref)!;
    return { kind: "derived", note: String(expr.name) };
  }
  if (expr.nodeType === "Conditional") {
    const t = resolveExpr(expr.trueExpression as AstNode, argProv);
    const f = resolveExpr(expr.falseExpression as AstNode, argProv);
    if (t.kind === "msg.sender" || f.kind === "msg.sender") return { kind: "msg.sender" };
    if (t.kind === "arg") return t;
    if (f.kind === "arg") return f;
    return { kind: "derived", note: "conditional" };
  }
  if (expr.nodeType === "Literal") return { kind: "constant", value: String(expr.value ?? "") };
  if (expr.nodeType === "FunctionCall") {
    const callee = expr.expression as AstNode | undefined;
    if (callee?.nodeType === "Identifier" && callee.name === "ecrecover")
      return { kind: "derived", note: "ecrecover" };
    return { kind: "derived", note: "call" };
  }
  return { kind: "unknown" };
}

interface Access2 {
  readonly op: Access;
  readonly keys: readonly KeyProvenance[];
}
interface ExternalTargetCall {
  readonly member: string;
  /** Provenance of each argument, resolved in the entry's argument context. */
  readonly args: readonly KeyProvenance[];
}
interface Collected {
  readonly accesses: readonly Access2[];
  readonly guards: readonly Guard[];
  readonly externalTargets: readonly ExternalTargetCall[];
  readonly hasEcrecover: boolean;
}

const MAX_DEPTH = 6;

/** Extracts the ordered key expressions of a full IndexAccess chain (outer→inner). */
function anchorKeys(indexAccess: AstNode): AstNode[] {
  const keys: AstNode[] = [];
  let e: AstNode | undefined = indexAccess;
  while (e && e.nodeType === "IndexAccess") {
    keys.unshift(e.indexExpression as AstNode);
    e = e.baseExpression as AstNode | undefined;
  }
  return keys;
}

/** Interprocedurally collects anchor accesses, guards, and external calls reachable from a
 *  function, resolving each anchor key's provenance in the entry's argument context. */
function collect(
  index: AstIndex,
  fn: AstNode,
  argProv: ArgProv,
  anchorVarId: number,
  depth: number,
  seen: Set<number>,
  targetMembers: ReadonlySet<string> = new Set(),
): Collected {
  const accesses: Access2[] = [];
  const externalTargets: ExternalTargetCall[] = [];
  const guards: Guard[] = [];
  let hasEcrecover = false;

  for (const mod of (fn.modifiers as AstNode[] | undefined) ?? []) {
    const name = (mod.modifierName as AstNode | undefined)?.name;
    if (name)
      guards.push({
        source: "modifier",
        expression: String(name),
        bindsCaller: /^only/i.test(String(name)),
        provenance: "verified",
      });
  }

  const visit = (node: unknown, write: Access | null): void => {
    if (Array.isArray(node)) return node.forEach((n) => visit(n, write));
    if (!node || typeof node !== "object") return;
    const n = node as AstNode;

    if (n.nodeType === "Assignment") {
      const op: Access = n.operator === "=" ? "write" : "read-write";
      visit(n.leftHandSide, op);
      visit(n.rightHandSide, null);
      return;
    }
    if (n.nodeType === "IndexAccess" && baseVarId(n) === anchorVarId) {
      const keys = anchorKeys(n).map((k) => resolveExpr(k, argProv));
      accesses.push({ op: write ?? "read", keys });
      return;
    }
    // Struct-member / mixed index+member access whose base is the anchor (e.g. `s.field`,
    // `balances[msg.sender].locked`). Keys are the index expressions along the chain.
    if (n.nodeType === "MemberAccess") {
      const chain = resolveAccessChain(n);
      if (chain && chain.varId === anchorVarId) {
        accesses.push({
          op: write ?? "read",
          keys: chain.keys.map((k) => resolveExpr(k, argProv)),
        });
        return;
      }
    }
    // Bare reference to a scalar anchor (e.g. `paused = true`, or reading `config`).
    if (
      n.nodeType === "Identifier" &&
      (n.referencedDeclaration as number | undefined) === anchorVarId
    ) {
      accesses.push({ op: write ?? "read", keys: [] });
      return;
    }
    // `delete X` writes X; recurse into the target with a write op.
    if (n.nodeType === "UnaryOperation" && n.operator === "delete") {
      visit(n.subExpression, "write");
      return;
    }
    if (n.nodeType === "FunctionCall") {
      const callee = n.expression as AstNode | undefined;
      if (callee?.nodeType === "Identifier") {
        const name = String(callee.name);
        if (name === "ecrecover") hasEcrecover = true;
        if (name === "require" || name === "assert") {
          guards.push({
            source: "require",
            expression: describeRequire(n),
            bindsCaller: bindsSender(n),
            provenance: "verified",
          });
        }
        const args = (n.arguments as AstNode[] | undefined) ?? [];
        const target = resolveCallee(
          index,
          name,
          args.length,
          callee.referencedDeclaration as number | undefined,
          anchorVarId,
        );
        if (
          target?.nodeType === "FunctionDefinition" &&
          depth < MAX_DEPTH &&
          typeof target.id === "number" &&
          !seen.has(target.id)
        ) {
          const childProv = new Map<number, KeyProvenance>();
          const params = functionParams(target);
          params.forEach((p, i) => {
            if (typeof p.id === "number") childProv.set(p.id, resolveExpr(args[i], argProv));
          });
          const child = collect(
            index,
            target,
            childProv,
            anchorVarId,
            depth + 1,
            new Set([...seen, target.id]),
            targetMembers,
          );
          accesses.push(...child.accesses);
          guards.push(...child.guards);
          externalTargets.push(...child.externalTargets);
          hasEcrecover ||= child.hasEcrecover;
        }
        for (const a of args) visit(a, null);
        return;
      }
      if (callee?.nodeType === "MemberAccess") {
        const member = String(callee.memberName);
        if (/isValidSignature|recover|toTypedDataHash/i.test(member)) hasEcrecover = true;
        if (targetMembers.has(member)) {
          const args = ((n.arguments as AstNode[] | undefined) ?? []).map((a) =>
            resolveExpr(a, argProv),
          );
          externalTargets.push({ member, args });
        }
      }
    }
    for (const key of Object.keys(n)) if (key !== "id") visit(n[key], null);
  };

  visit(fn.body, null);
  return { accesses, guards, externalTargets, hasEcrecover };
}

function describeRequire(call: AstNode): string {
  const arg = ((call.arguments as AstNode[] | undefined) ?? [])[0];
  if (arg?.nodeType === "BinaryOperation") {
    const l = arg.leftExpression as AstNode | undefined;
    const r = arg.rightExpression as AstNode | undefined;
    return `${exprName(l)} ${String(arg.operator)} ${exprName(r)}`;
  }
  return "require(...)";
}
const exprName = (e: AstNode | undefined): string => {
  if (!e) return "?";
  if (e.nodeType === "MemberAccess")
    return `${exprName(e.expression as AstNode)}.${String(e.memberName)}`;
  if (e.nodeType === "Identifier") return String(e.name);
  if (e.nodeType === "FunctionCall") return `${exprName(e.expression as AstNode)}(..)`;
  return e.nodeType ?? "?";
};
function bindsSender(call: AstNode): boolean {
  const arg = ((call.arguments as AstNode[] | undefined) ?? [])[0];
  if (arg?.nodeType !== "BinaryOperation" || arg.operator !== "==") return false;
  return [arg.leftExpression, arg.rightExpression].some((s) =>
    exprName(s as AstNode).includes("msg.sender"),
  );
}

/** Combines key provenance + concrete anchor keys + guards into a boundedness verdict. */
function solveBoundedness(
  keys: readonly KeyProvenance[],
  concrete: readonly (string | undefined)[],
  guards: readonly Guard[],
  hasEcrecover: boolean,
): Boundedness {
  for (let i = 0; i < keys.length; i++) {
    const c = concrete[i];
    if (keys[i]?.kind === "msg.sender" && c)
      return { kind: "singleton", callers: [c as `0x${string}`], guards };
  }
  const role = guards.find((g) => g.source === "modifier" && g.bindsCaller);
  if (role) return { kind: "role-set", roleVar: role.expression, enumeration: "events", guards };
  if (hasEcrecover) {
    return {
      kind: "unbounded",
      reason:
        "permissionless entrypoint; effect gated by owner signature (ecrecover), caller identity unconstrained",
      guards,
    };
  }
  return {
    kind: "unbounded",
    reason: "no msg.sender-keyed dimension or guard binds the caller to this concrete entry",
    guards,
  };
}

function aggregateOp(accesses: readonly Access2[]): Access {
  const w = accesses.some((a) => a.op === "write" || a.op === "read-write");
  const r = accesses.some((a) => a.op === "read" || a.op === "read-write");
  return w && r ? "read-write" : w ? "write" : "read";
}

/** Picks the representative key provenance (the widest access, preferring a write). */
function representativeKeys(accesses: readonly Access2[]): readonly KeyProvenance[] {
  const ranked = [...accesses].sort(
    (a, b) => Number(b.op !== "read") - Number(a.op !== "read") || b.keys.length - a.keys.length,
  );
  return ranked[0]?.keys ?? [];
}

function findStateVarId(index: AstIndex, name: string): number | undefined {
  let id: number | undefined;
  for (const node of index.byId.values()) {
    if (
      node.nodeType === "VariableDeclaration" &&
      node.stateVariable === true &&
      node.name === name &&
      typeof node.id === "number"
    )
      id = node.id;
  }
  return id;
}

export function resolveEntry(index: AstIndex, name: string, arity: number): AstNode | undefined {
  const impls = (index.implemented.get(name) ?? []).filter(
    (f) => functionParams(f).length === arity,
  );
  return impls.find((f) => f.visibility === "external" || f.visibility === "public") ?? impls[0];
}

/** Maps every state variable's declaration id to its name, across all indexed contracts. */
export function stateVarNames(index: AstIndex): Map<number, string> {
  const out = new Map<number, string>();
  for (const node of index.byId.values()) {
    if (
      node.nodeType === "VariableDeclaration" &&
      node.stateVariable === true &&
      typeof node.id === "number" &&
      node.name
    ) {
      out.set(node.id, String(node.name));
    }
  }
  return out;
}

/**
 * Finds every public/external entrypoint that touches the anchor variable, with the
 * boundedness of the concrete anchor entry. `concreteKeys` are the seed-derived key values.
 */
export function analyzeAnchor(
  compiled: Compiled,
  anchorVar: string,
  baseSlot: string,
  anchorType: string,
  concreteKeys: readonly (string | undefined)[],
): AnchorAnalysis {
  const index = indexAst(compiled.asts);
  const anchorVarId = findStateVarId(index, anchorVar);
  const abi = compiled.abi as readonly AbiFunction[];
  const touchers: Toucher[] = [];

  if (anchorVarId !== undefined) {
    for (const item of abi) {
      if (item.type !== "function") continue;
      const fn = resolveEntry(index, item.name, item.inputs.length);
      if (!fn) continue;
      const argProv = new Map<number, KeyProvenance>();
      functionParams(fn).forEach((p, i) => {
        if (typeof p.id === "number")
          argProv.set(p.id, { kind: "arg", index: i, ...(p.name ? { name: String(p.name) } : {}) });
      });
      const c = collect(index, fn, argProv, anchorVarId, 0, new Set([fn.id as number]));
      if (c.accesses.length === 0) continue;
      const keys = representativeKeys(c.accesses);
      touchers.push({
        functionName: item.name,
        selector: toFunctionSelector(item),
        op: aggregateOp(c.accesses),
        boundedness: solveBoundedness(keys, concreteKeys, c.guards, c.hasEcrecover),
        keys,
      });
    }
  }
  return { contractName: compiled.contractName, anchorVar, baseSlot, anchorType, touchers };
}

export type SpenderConstraint =
  | { readonly kind: "caller-is-owner" } // key arg = msg.sender → the entry's caller must be the key-holder
  | { readonly kind: "unbounded"; readonly reason: string } // key arg = caller arg → anyone can direct it
  | { readonly kind: "opaque"; readonly note: string }; // key arg = derived/stored → deeper analysis needed

/** A token member call to follow, and the argument index that carries the anchor's key. */
export interface TargetSpec {
  readonly member: string;
  readonly argIndex: number;
}

export interface CallerRoute {
  readonly functionName: string;
  /** Declaring contract of the resolved entrypoint (may be a base of the deployed one). */
  readonly contract: string;
  readonly selector: string;
  readonly member: string;
  readonly fromProvenance: KeyProvenance;
  readonly constraint: SpenderConstraint;
}

function fromOf(
  t: ExternalTargetCall,
  argIndexByMember: ReadonlyMap<string, number>,
): KeyProvenance {
  return t.args[argIndexByMember.get(t.member) ?? 0] ?? { kind: "unknown" };
}
// lower = more permissive; the aggregate takes the weakest protection across a fn's targets
function severity(from: KeyProvenance): number {
  return from.kind === "arg" ? 0 : from.kind === "msg.sender" ? 1 : 2;
}
function constraintOf(from: KeyProvenance): SpenderConstraint {
  if (from.kind === "arg")
    return {
      kind: "unbounded",
      reason: `the anchor-key argument is caller-supplied ('${from.name ?? `#${from.index}`}'); any address can direct this call at the key-holder's slot`,
    };
  if (from.kind === "msg.sender") return { kind: "caller-is-owner" };
  if (from.kind === "derived")
    return { kind: "opaque", note: `anchor-key argument derives from ${from.note}` };
  return { kind: "opaque", note: `anchor-key argument provenance is ${from.kind}` };
}

/**
 * Caller-side analysis: for each public/external entrypoint that transitively calls one of the
 * target token members, resolve the provenance of the argument that carries the anchor's key (per
 * `TargetSpec.argIndex`) and derive who must call it for the *key-holder's* slot to be touched.
 * This is what lets the recursion continue past a caller — the key arg = msg.sender pins the
 * caller back to the key-holder; a caller-supplied key arg flags a permissionless action.
 */
export function analyzeCallers(
  compiled: Compiled,
  targets: readonly TargetSpec[],
): readonly CallerRoute[] {
  const index = indexAst(compiled.asts);
  const argIndexByMember = new Map(targets.map((t) => [t.member, t.argIndex]));
  const memberSet = new Set(targets.map((t) => t.member));
  const abi = compiled.abi as readonly AbiFunction[];
  const out = new Map<string, CallerRoute>();

  // member id → declaring contract name, to label each resolved entrypoint
  const ownerContract = new Map<number, string>();
  for (const node of index.byId.values()) {
    if (node.nodeType !== "ContractDefinition") continue;
    for (const member of (node.nodes as AstNode[] | undefined) ?? []) {
      if (typeof member.id === "number") ownerContract.set(member.id, String(node.name));
    }
  }

  for (const item of abi) {
    if (item.type !== "function") continue;
    const fn = resolveEntry(index, item.name, item.inputs.length);
    if (!fn) continue;
    const argProv = new Map<number, KeyProvenance>();
    functionParams(fn).forEach((p, i) => {
      if (typeof p.id === "number")
        argProv.set(p.id, { kind: "arg", index: i, ...(p.name ? { name: String(p.name) } : {}) });
    });
    const c = collect(index, fn, argProv, -1, 0, new Set([fn.id as number]), memberSet);
    if (c.externalTargets.length === 0) continue;

    const target = [...c.externalTargets].sort(
      (a, b) => severity(fromOf(a, argIndexByMember)) - severity(fromOf(b, argIndexByMember)),
    )[0]!;
    const from = fromOf(target, argIndexByMember);
    const contract =
      (typeof fn.id === "number" ? ownerContract.get(fn.id) : undefined) ?? compiled.contractName;
    out.set(item.name, {
      functionName: item.name,
      contract,
      selector: toFunctionSelector(item),
      member: target.member,
      fromProvenance: from,
      constraint: constraintOf(from),
    });
  }
  return [...out.values()];
}
