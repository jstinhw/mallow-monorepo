/** Minimal shape of the solc compact-AST nodes we traverse. */
export interface AstNode {
  readonly nodeType?: string;
  readonly id?: number;
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface AstIndex {
  readonly byId: Map<number, AstNode>;
  /** name -> implemented FunctionDefinitions (body present), for call resolution. */
  readonly implemented: Map<string, readonly AstNode[]>;
}

const isNode = (v: unknown): v is AstNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Depth-first visit of every AstNode in a tree. */
export function walk(node: unknown, visit: (n: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key !== "id") walk(node[key], visit);
  }
}

const paramCount = (fn: AstNode): number => {
  const params = (fn.parameters as { parameters?: unknown[] } | undefined)?.parameters;
  return Array.isArray(params) ? params.length : 0;
};

const isImplemented = (fn: AstNode): boolean =>
  fn.body !== null && fn.body !== undefined && fn.implemented !== false;

/** Indexes every node id and maps function names to their implemented definitions so
 *  virtual/override internal calls resolve to real bodies. */
export function indexAst(asts: Record<string, unknown>): AstIndex {
  const byId = new Map<number, AstNode>();
  const implemented = new Map<string, AstNode[]>();

  for (const ast of Object.values(asts)) {
    walk(ast, (n) => {
      if (typeof n.id === "number") byId.set(n.id, n);
      if (n.nodeType === "FunctionDefinition" && n.name && isImplemented(n)) {
        const list = implemented.get(n.name) ?? [];
        implemented.set(n.name, [...list, n]);
      }
    });
  }
  return { byId, implemented };
}

export const functionParams = (fn: AstNode): readonly AstNode[] =>
  (fn.parameters as { parameters?: AstNode[] } | undefined)?.parameters ?? [];

/**
 * Resolves an internal call to the concrete function that runs. Prefers, among implemented
 * candidates with a matching name + arity, one whose subtree references `anchorVarId`
 * (the writer we care about); otherwise the first implemented candidate; otherwise the
 * statically referenced declaration.
 */
export function resolveCallee(
  index: AstIndex,
  name: string,
  arity: number,
  referencedId: number | undefined,
  anchorVarId: number,
): AstNode | undefined {
  const candidates = (index.implemented.get(name) ?? []).filter((f) => paramCount(f) === arity);
  const touching = candidates.find((f) => subtreeTouches(f.body, anchorVarId));
  if (touching) return touching;
  if (candidates.length > 0) return candidates[0];
  return referencedId !== undefined ? index.byId.get(referencedId) : undefined;
}

/** True if the subtree references `varId`, whether via an index/member chain or bare. */
export function subtreeTouches(node: unknown, varId: number): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.nodeType === "IndexAccess" && baseVarId(n) === varId) found = true;
    else if (
      n.nodeType === "Identifier" &&
      (n.referencedDeclaration as number | undefined) === varId
    )
      found = true;
  });
  return found;
}

/** Walks an IndexAccess chain down to the base Identifier and returns its declaration id. */
export function baseVarId(indexAccess: AstNode): number | undefined {
  let e: AstNode | undefined = indexAccess;
  while (e && e.nodeType === "IndexAccess") e = e.baseExpression as AstNode | undefined;
  return e?.nodeType === "Identifier" ? (e.referencedDeclaration as number | undefined) : undefined;
}

/** A resolved storage access: the base variable plus the index keys and member names on the path. */
export interface AccessChain {
  readonly varId: number;
  /** Index-access key expressions, outer→inner (e.g. `m[a][b]` → [a, b]). */
  readonly keys: readonly AstNode[];
  /** Member names, outer→inner (e.g. `s.a.b` → ["a", "b"]). */
  readonly members: readonly string[];
}

/**
 * Resolves an access expression (any mix of IndexAccess / MemberAccess ending in an Identifier)
 * to the base variable it targets, collecting the index keys and member names along the way.
 * Generalizes `baseVarId` past pure mapping/array chains to scalars and struct members.
 */
export function resolveAccessChain(expr: AstNode | undefined): AccessChain | undefined {
  const keys: AstNode[] = [];
  const members: string[] = [];
  let e: AstNode | undefined = expr;
  while (e) {
    if (e.nodeType === "IndexAccess") {
      keys.unshift(e.indexExpression as AstNode);
      e = e.baseExpression as AstNode | undefined;
    } else if (e.nodeType === "MemberAccess") {
      members.unshift(String(e.memberName));
      e = e.expression as AstNode | undefined;
    } else break;
  }
  if (e?.nodeType !== "Identifier") return undefined;
  const varId = e.referencedDeclaration as number | undefined;
  return typeof varId === "number" ? { varId, keys, members } : undefined;
}

/**
 * Names of the contracts `contractName` inherits, in linearization order (self excluded,
 * interfaces skipped — these are the declaring-contract labels that appear in call traces).
 */
export function inheritedContractNames(index: AstIndex, contractName: string): readonly string[] {
  let target: AstNode | undefined;
  for (const node of index.byId.values()) {
    if (node.nodeType === "ContractDefinition" && node.name === contractName) target = node;
  }
  const baseIds = (target?.linearizedBaseContracts as number[] | undefined) ?? [];
  return baseIds
    .map((id) => index.byId.get(id))
    .filter(
      (n): n is AstNode =>
        n !== undefined && n.name !== contractName && n.contractKind !== "interface",
    )
    .map((n) => String(n.name));
}
