import { indexAst, resolveCallee, walk, type AstIndex, type AstNode } from "./ast";
import type { Compiled } from "./compile";

export interface CompressedSlice {
  /** Names of the functions kept (touch the coupled storage, transitively). */
  readonly functions: readonly string[];
  /** Declared names of the storage variables kept. */
  readonly storage: readonly string[];
  /** Extracted, compressed source: coupled storage + coupled functions. */
  readonly sourceSlice: string;
}

/** A node in one entrypoint's call tree: an internal `Contract.fn`, or (when `external`)
 *  a member call site on the traced route, e.g. `safeTransferFrom(token, payer, ...)`. */
export interface CallTreeNode {
  readonly label: string;
  readonly children: readonly CallTreeNode[];
  readonly external?: boolean;
}

/** One entrypoint's transitive internal call trace, as a tree rooted at the entry. */
export interface CallClosureTrace {
  readonly entry: string;
  readonly tree: CallTreeNode;
}

/** Call-closure slice plus the per-entrypoint call tracking used for step logging. */
export interface CallClosureSlice extends CompressedSlice {
  readonly closures: readonly CallClosureTrace[];
}

/** One `x.member(args)` call site inside a function (external or library call). */
interface MemberCallSite {
  readonly member: string;
  readonly args: readonly string[];
}

interface Model {
  readonly index: AstIndex;
  readonly stateVarIds: Set<number>;
  readonly varById: Map<number, AstNode>;
  readonly fnById: Map<number, AstNode>;
  /** state-var ids a function references directly (not via calls). */
  readonly directTouch: Map<number, Set<number>>;
  /** implemented internal functions a function calls. */
  readonly callees: Map<number, Set<number>>;
  /** member call sites (MemberAccess callees) a function makes directly. */
  readonly memberCalls: Map<number, readonly MemberCallSite[]>;
  readonly ownerContract: Map<number, string>;
}

/** Compact one-line rendering of an argument expression (for call-site labels). */
function exprShort(e: AstNode | undefined): string {
  if (!e) return "?";
  if (e.nodeType === "Identifier") return String(e.name);
  if (e.nodeType === "MemberAccess")
    return `${exprShort(e.expression as AstNode)}.${String(e.memberName)}`;
  if (e.nodeType === "Literal") return String(e.value ?? "?");
  if (e.nodeType === "FunctionCall") return `${exprShort(e.expression as AstNode)}(..)`;
  if (e.nodeType === "IndexAccess") return `${exprShort(e.baseExpression as AstNode)}[..]`;
  if (e.nodeType === "ElementaryTypeNameExpression") {
    const t = e.typeName as AstNode | string | undefined;
    return typeof t === "string" ? t : String((t as AstNode | undefined)?.name ?? "type");
  }
  return String(e.nodeType ?? "?");
}

function buildModel(compiled: Compiled): Model {
  const index = indexAst(compiled.asts);
  const stateVarIds = new Set<number>();
  const varById = new Map<number, AstNode>();
  const fnById = new Map<number, AstNode>();
  const ownerContract = new Map<number, string>();

  for (const node of index.byId.values()) {
    if (
      node.nodeType === "VariableDeclaration" &&
      node.stateVariable === true &&
      typeof node.id === "number"
    ) {
      stateVarIds.add(node.id);
      varById.set(node.id, node);
    }
    if (node.nodeType === "FunctionDefinition" && typeof node.id === "number")
      fnById.set(node.id, node);
    if (node.nodeType === "ContractDefinition") {
      for (const member of (node.nodes as AstNode[] | undefined) ?? []) {
        if (typeof member.id === "number") ownerContract.set(member.id, String(node.name));
      }
    }
  }

  const directTouch = new Map<number, Set<number>>();
  const callees = new Map<number, Set<number>>();
  const memberCalls = new Map<number, readonly MemberCallSite[]>();
  for (const [id, fn] of fnById) {
    const touched = new Set<number>();
    const called = new Set<number>();
    const sites: MemberCallSite[] = [];
    walk(fn.body, (n) => {
      if (n.nodeType === "Identifier") {
        const ref = n.referencedDeclaration as number | undefined;
        if (ref !== undefined && stateVarIds.has(ref)) touched.add(ref);
      }
      if (n.nodeType === "FunctionCall") {
        const callee = n.expression as AstNode | undefined;
        if (callee?.nodeType === "Identifier") {
          const arity = ((n.arguments as unknown[] | undefined) ?? []).length;
          const target = resolveCallee(
            index,
            String(callee.name),
            arity,
            callee.referencedDeclaration as number | undefined,
            -1,
          );
          if (target?.nodeType === "FunctionDefinition" && typeof target.id === "number")
            called.add(target.id);
        }
        if (callee?.nodeType === "MemberAccess") {
          sites.push({
            member: String(callee.memberName),
            args: ((n.arguments as AstNode[] | undefined) ?? []).map(exprShort),
          });
        }
      }
    });
    directTouch.set(id, touched);
    callees.set(id, called);
    memberCalls.set(id, sites);
  }
  return { index, stateVarIds, varById, fnById, directTouch, callees, memberCalls, ownerContract };
}

/** Storage a function touches directly or through its (transitive) internal callees. */
function transitiveTouch(model: Model): (id: number) => Set<number> {
  const memo = new Map<number, Set<number>>();
  const active = new Set<number>();
  const visit = (id: number): Set<number> => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (active.has(id)) return new Set();
    active.add(id);
    const result = new Set(model.directTouch.get(id) ?? []);
    for (const callee of model.callees.get(id) ?? []) for (const v of visit(callee)) result.add(v);
    active.delete(id);
    memo.set(id, result);
    return result;
  };
  return visit;
}

function varIdsByName(model: Model, names: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const name of names) for (const [id, v] of model.varById) if (v.name === name) ids.add(id);
  return ids;
}
function fnIdsByName(model: Model, names: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const name of names)
    for (const f of model.index.implemented.get(name) ?? [])
      if (typeof f.id === "number") ids.add(f.id);
  return ids;
}

/**
 * Storage-coupling slice (the anchor case): from the seed storage vars, repeatedly (a)
 * include every function that transitively touches a relevant var, and (b) mark relevant
 * every var such a function touches *directly* (co-touch coupling). So `A→anchor`,
 * `B→anchor,I`, `C→I`, `D→∅` yields functions {A,B,C} and storage {anchor,I}; D is dropped.
 */
export function sliceByStorageCoupling(
  compiled: Compiled,
  varNames: readonly string[],
): CompressedSlice {
  const model = buildModel(compiled);
  const trans = transitiveTouch(model);
  const relevantVars = varIdsByName(model, varNames);
  const relevantFns = new Set<number>();

  for (let changed = true; changed;) {
    changed = false;
    for (const [id] of model.fnById) {
      if (relevantFns.has(id)) continue;
      if ([...trans(id)].some((v) => relevantVars.has(v))) {
        relevantFns.add(id);
        changed = true;
      }
    }
    for (const id of relevantFns) {
      const direct = model.directTouch.get(id) ?? new Set<number>();
      if (![...direct].some((v) => relevantVars.has(v))) continue;
      for (const v of direct)
        if (!relevantVars.has(v)) {
          relevantVars.add(v);
          changed = true;
        }
    }
  }
  return render(compiled, model, relevantVars, relevantFns);
}

/** Transitive internal callees of one function (BFS, excluding the seed itself). */
function transitiveCallees(model: Model, seed: number): Set<number> {
  const seen = new Set<number>();
  const queue = [seed];
  while (queue.length > 0) {
    for (const callee of model.callees.get(queue.shift()!) ?? []) {
      if (callee !== seed && !seen.has(callee)) {
        seen.add(callee);
        queue.push(callee);
      }
    }
  }
  return seen;
}

/** Call tree rooted at `id` (cycle-safe: a callee already on the path is cut). Member
 *  calls whose name is in `targets` become external leaves at their true position, so the
 *  route to the traced token call reads exactly as the code executes it. */
function callTree(
  model: Model,
  id: number,
  label: (id: number) => string,
  targets: ReadonlySet<string>,
  path: ReadonlySet<number>,
): CallTreeNode {
  const internal = [...(model.callees.get(id) ?? [])]
    .filter((callee) => !path.has(callee))
    .map((callee) => callTree(model, callee, label, targets, new Set([...path, callee])));
  const external = (model.memberCalls.get(id) ?? [])
    .filter((site) => targets.has(site.member))
    .map((site) => ({
      label: `${site.member}(${site.args.join(", ")})`,
      children: [],
      external: true,
    }));
  return { label: label(id), children: [...internal, ...external] };
}

/**
 * Call-closure slice (the spender case — no storage anchor): keep the seed functions plus
 * everything they transitively call, and declare the storage they touch. Bounded by
 * reachability from the seeds, so a widely-shared router var doesn't pull the whole contract.
 * Also reports, per entrypoint, its call tree (`closures`) — internal hops plus any
 * `targetMembers` call sites (the traced token calls) at their true position.
 */
export function sliceByCallClosure(
  compiled: Compiled,
  fnNames: readonly string[],
  targetMembers: readonly string[] = [],
): CallClosureSlice {
  const model = buildModel(compiled);
  const label = (id: number): string => {
    const n = model.fnById.get(id);
    return `${model.ownerContract.get(id) ?? "?"}.${n ? fnLabel(n) : String(id)}`;
  };

  const seeds = fnIdsByName(model, fnNames);
  const perSeed = [...seeds].map((seed) => ({ seed, callees: transitiveCallees(model, seed) }));
  const relevantFns = new Set<number>([...seeds, ...perSeed.flatMap((p) => [...p.callees])]);
  const relevantVars = new Set<number>();
  for (const id of relevantFns)
    for (const v of model.directTouch.get(id) ?? []) relevantVars.add(v);

  // the flattened unit can hold the same function under several ASTs — dedup by label
  const targets = new Set(targetMembers);
  const seen = new Set<string>();
  const closures = perSeed
    .map((p) => ({
      entry: label(p.seed),
      tree: callTree(model, p.seed, label, targets, new Set([p.seed])),
    }))
    .filter((c) => (seen.has(c.entry) ? false : (seen.add(c.entry), true)));
  return { ...render(compiled, model, relevantVars, relevantFns), closures };
}

// ── source extraction ────────────────────────────────────────────────────────
function fileContents(compiled: Compiled): Map<number, string> {
  const map = new Map<number, string>();
  for (const [path, ast] of Object.entries(compiled.asts)) {
    const src = (ast as AstNode).src as string | undefined;
    const content = compiled.sources[path];
    if (src && content !== undefined) map.set(Number(src.split(":")[2]), content);
  }
  return map;
}

function extract(
  node: AstNode,
  files: Map<number, string>,
): { text: string; file: number; start: number } | undefined {
  const src = node.src as string | undefined;
  if (!src) return undefined;
  const [start, len, file] = src.split(":").map(Number) as [number, number, number];
  const content = files.get(file);
  if (content === undefined) return undefined;
  return {
    text: Buffer.from(content, "utf8")
      .subarray(start, start + len)
      .toString("utf8"),
    file,
    start,
  };
}

const fnLabel = (n: AstNode): string => String(n.name) || String(n.kind ?? "fn");

function render(
  compiled: Compiled,
  model: Model,
  vars: Set<number>,
  fns: Set<number>,
): CompressedSlice {
  const files = fileContents(compiled);
  const order = (a: { file: number; start: number }, b: { file: number; start: number }) =>
    a.file - b.file || a.start - b.start;

  const seenV = new Set<string>();
  const storageDecls = [...vars]
    .flatMap((id) => {
      const node = model.varById.get(id);
      const e = node && extract(node, files);
      return e ? [{ ...e, comment: `  // ${model.ownerContract.get(id) ?? ""}` }] : [];
    })
    .filter((d) => (seenV.has(d.text) ? false : (seenV.add(d.text), true)))
    .sort(order);

  const seenF = new Set<string>();
  const fnDefs = [...fns]
    .flatMap((id) => {
      const node = model.fnById.get(id);
      const e = node?.body ? extract(node, files) : undefined;
      return e && node
        ? [{ ...e, contract: model.ownerContract.get(id) ?? "", name: fnLabel(node) }]
        : [];
    })
    .filter((f) => (seenF.has(f.text) ? false : (seenF.add(f.text), true)))
    .sort(order);

  const varNames = [
    ...new Set(
      [...vars].flatMap((id) => {
        const v = model.varById.get(id);
        return v ? [String(v.name)] : [];
      }),
    ),
  ];
  const fnNames = [
    ...new Set(
      [...fns].flatMap((id) => {
        const n = model.fnById.get(id);
        return n?.body ? [fnLabel(n)] : [];
      }),
    ),
  ];

  const indent = (s: string) =>
    s
      .split("\n")
      .map((l) => (l ? `  ${l}` : l))
      .join("\n");
  const body = [
    ...storageDecls.map((d) => `${d.comment}\n  ${d.text};`),
    "",
    ...fnDefs.map((d) => `  // ${d.contract}.${d.name}\n${indent(d.text)}`),
  ].join("\n");

  const header =
    `// Compressed slice of ${compiled.contractName}: code coupled to storage [${varNames.join(", ")}].\n` +
    `// Semantic slice for review — may reference symbols defined in the full contract.\n`;
  const sourceSlice = `${header}contract ${compiled.contractName}__slice {\n${body}\n}\n`;

  return { functions: fnNames, storage: varNames, sourceSlice };
}
