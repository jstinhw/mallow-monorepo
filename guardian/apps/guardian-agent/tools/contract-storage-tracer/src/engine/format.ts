import type { KeyProvenance } from "../types/anchor";
import type { Boundedness } from "../types/constraint";
import type { AddressReport } from "../types/report";
import type { ContractInfo } from "../acquire/contract";
import type { CallTreeNode } from "../analyze/slice";
import { indexAst, inheritedContractNames } from "../analyze/ast";
import type { StepLogger } from "../log";

/**
 * Presentation-only helpers for the step log. Nothing here feeds the report — every
 * function renders an already-computed fact into the human-readable trace lines, so the
 * engine phases stay free of string formatting.
 */

export function provLabel(p: KeyProvenance): string {
  return p.kind === "arg"
    ? `arg:${p.name ?? p.index}`
    : p.kind === "derived"
      ? `derived:${p.note}`
      : p.kind;
}

export function boundLabel(b: Boundedness): string {
  if (b.kind === "singleton") return `singleton{${b.callers.map((a) => a.slice(0, 10)).join(",")}}`;
  if (b.kind === "fixed-onchain") return `fixed-onchain{${b.caller.slice(0, 10)}}`;
  if (b.kind === "role-set") return `role-set{${b.roleVar}}`;
  return "unbounded";
}

/** Log-only address-book tag: proxy implementation + inherited contract names (the base
 *  names that appear as declaring-contract labels in the call traces). Not in the report. */
export function bookTag(info: ContractInfo): string {
  if (info.kind === "unverified")
    return info.implementation ? ` (proxy → impl ${info.implementation})` : "";
  if (info.kind !== "contract") return "";
  const bases = inheritedContractNames(indexAst(info.compiled.asts), info.contractName);
  const bits = [
    ...(info.implementation ? [`(proxy → impl ${info.implementation})`] : []),
    ...(bases.length ? [`· inherits ${bases.join(", ")}`] : []),
  ];
  return bits.length ? ` ${bits.join(" ")}` : "";
}

/** One address-book line: address = name/classification, for reading the trace lines above. */
export function addressBookLine(a: AddressReport): string {
  if (a.classification === "contract") return `${a.address} = ${a.note ?? "contract"}`;
  const bits = [
    a.classification,
    ...(a.ens ? [a.ens] : []),
    ...(a.labels?.length ? [a.labels.join(",")] : []),
    ...(a.delegation ? [`7702→${a.delegation.slice(0, 10)}`] : []),
    ...(a.nonce !== undefined ? [`nonce ${a.nonce}`] : []),
  ];
  return `${a.address} = ${bits.join(" · ")}`;
}

export function tagSuffix(info: Extract<ContractInfo, { enrichment: unknown }>): string {
  const t = info.enrichment.tags;
  const bits = [
    ...(t.ens ? [t.ens] : []),
    ...(t.labels.length ? [t.labels.join(",")] : []),
    ...("delegation" in info && info.delegation ? [`7702→${info.delegation.slice(0, 10)}`] : []),
  ];
  return `${bits.length ? " " + bits.join(" ") : ""} · nonce ${info.enrichment.nonce}`;
}

/** Draws an entrypoint's call tree under its route note (root line excluded). External
 *  leaves — the traced token call sites — get the destination `Token.fn` appended. */
export function logCallTree(log: StepLogger, root: CallTreeNode, externalDest: string): void {
  const walk = (node: CallTreeNode, prefix: string): void => {
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      log.tree(
        `${prefix}${last ? "└─" : "├─"} ${child.external ? `${child.label} → ${externalDest}` : child.label}`,
      );
      walk(child, `${prefix}${last ? "   " : "│  "}`);
    });
  };
  walk(root, "");
}
