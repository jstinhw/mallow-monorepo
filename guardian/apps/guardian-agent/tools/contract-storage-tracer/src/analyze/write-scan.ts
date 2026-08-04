import type { Access } from "../types/common"
import type { KeyProvenance } from "../types/anchor"
import type { Compiled } from "./compile"
import { functionParams, indexAst, resolveAccessChain, resolveCallee, type AstIndex, type AstNode } from "./ast"
import { resolveEntry, resolveExpr, stateVarNames } from "./anchor-analyzer"

/**
 * One state-variable write reachable from a single entrypoint. `keys` is the caller-provenance of
 * each mapping/array index (empty for scalars); `memberPath` names any struct members / array ops
 * on the write target. Feeds anchor synthesis on the static path and the write/read split when the
 * observer could only report *touched* slots (access-list tier).
 */
export interface StaticWrite {
  readonly varName: string
  readonly keys: readonly KeyProvenance[]
  readonly memberPath: readonly string[]
  readonly op: Access
}

const MAX_DEPTH = 6

function widen(a: Access, b: Access): Access {
  if (a === b) return a
  return "read-write"
}

/** Interprocedurally collects every state-variable write reachable from a function. */
function scanFn(
  index: AstIndex,
  fn: AstNode,
  argProv: ReadonlyMap<number, KeyProvenance>,
  stateVars: ReadonlyMap<number, string>,
  depth: number,
  seen: ReadonlySet<number>,
): StaticWrite[] {
  const writes: StaticWrite[] = []

  const emit = (target: ReturnType<typeof resolveAccessChain>, op: Access): void => {
    if (!target) return
    const varName = stateVars.get(target.varId)
    if (!varName) return
    writes.push({ varName, keys: target.keys.map((k) => resolveExpr(k, argProv)), memberPath: target.members, op })
  }

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== "object") return
    const n = node as AstNode

    if (n.nodeType === "Assignment") {
      const op: Access = n.operator === "=" ? "write" : "read-write"
      const target = resolveAccessChain(n.leftHandSide as AstNode)
      if (target && stateVars.has(target.varId)) emit(target, op)
      else visit(n.leftHandSide) // tuple/other LHS shapes may still nest writes
      visit(n.rightHandSide)
      return
    }
    if (n.nodeType === "UnaryOperation" && n.operator === "delete") {
      const target = resolveAccessChain(n.subExpression as AstNode)
      if (target && stateVars.has(target.varId)) emit(target, "write")
      else visit(n.subExpression)
      return
    }
    if (n.nodeType === "FunctionCall") {
      const callee = n.expression as AstNode | undefined
      const args = (n.arguments as AstNode[] | undefined) ?? []
      if (callee?.nodeType === "MemberAccess" && (callee.memberName === "push" || callee.memberName === "pop")) {
        const target = resolveAccessChain(callee.expression as AstNode)
        if (target && stateVars.has(target.varId)) emit(target, "write")
      }
      if (callee?.nodeType === "Identifier") {
        const target = resolveCallee(index, String(callee.name), args.length, callee.referencedDeclaration as number | undefined, -1)
        if (target?.nodeType === "FunctionDefinition" && depth < MAX_DEPTH && typeof target.id === "number" && !seen.has(target.id)) {
          const childProv = new Map<number, KeyProvenance>()
          functionParams(target).forEach((p, i) => {
            if (typeof p.id === "number") childProv.set(p.id, resolveExpr(args[i], argProv))
          })
          writes.push(...scanFn(index, target, childProv, stateVars, depth + 1, new Set([...seen, target.id])))
        }
      }
      for (const a of args) visit(a)
      return
    }
    for (const key of Object.keys(n)) if (key !== "id") visit(n[key])
  }

  visit(fn.body)
  return writes
}

/** Deduplicates writes by (var, member path, key provenance), widening the access op. */
function dedupe(writes: readonly StaticWrite[]): readonly StaticWrite[] {
  const byKey = new Map<string, StaticWrite>()
  for (const w of writes) {
    const key = `${w.varName}|${w.memberPath.join(".")}|${w.keys.map((k) => k.kind).join(",")}`
    const prior = byKey.get(key)
    byKey.set(key, prior ? { ...prior, op: widen(prior.op, w.op) } : w)
  }
  return [...byKey.values()]
}

/**
 * Every state variable the named entrypoint writes, resolving internal calls and rebinding key
 * provenance to the entrypoint's argument context. Returns `[]` when the function isn't found.
 */
export function analyzeWrites(compiled: Compiled, functionName: string, arity: number): readonly StaticWrite[] {
  const index = indexAst(compiled.asts)
  const fn = resolveEntry(index, functionName, arity)
  if (!fn) return []
  const stateVars = stateVarNames(index)
  const argProv = new Map<number, KeyProvenance>()
  functionParams(fn).forEach((p, i) => {
    if (typeof p.id === "number") argProv.set(p.id, { kind: "arg", index: i, ...(p.name ? { name: String(p.name) } : {}) })
  })
  return dedupe(scanFn(index, fn, argProv, stateVars, 0, new Set([fn.id as number])))
}
