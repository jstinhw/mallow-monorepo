import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentReport } from "./agent";

const DECISION_LABEL = {
  sign: "SAFE TO SIGN",
  review: "REVIEW BEFORE SIGNING",
  reject: "DO NOT SIGN",
} as const;

export function formatVerdictReport(report: AgentReport): string {
  const { verdict, evidence } = report;
  const decoded = verdict.decoded;
  const argsLine = decoded.args.map((a) => `${a.name ?? a.type ?? "arg"}=${a.value}`).join(", ");
  const lines = [
    "# Guardian Verdict",
    "",
    `**Risk: ${verdict.risk.toUpperCase()} — ${DECISION_LABEL[verdict.decision]}**`,
    "",
    verdict.summary,
    "",
    "## Impact of signing",
    ...verdict.impacts.map((i) => `- ${i}`),
    "",
    "## Findings",
    ...verdict.findings.map((f) => `- [${f.severity}] ${f.title} — ${f.detail}`),
    "",
    "## Checks",
    ...verdict.checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.title} — ${c.detail}`),
    "",
    "## Decoded call",
    `${decoded.functionName}(${argsLine}) — selector ${decoded.selector} via ${decoded.source}`,
    "",
  ];
  if (verdict.llm) {
    lines.push("## Guardian's analysis", verdict.llm.reasoning, "");
    if (verdict.llm.investigation) lines.push("## Investigation", verdict.llm.investigation, "");
  }
  lines.push(
    "## Evidence",
    ...evidence.toolCalls.map(
      (tc) => `- round ${tc.round} \`${tc.tool}\` ${tc.ok ? "ok" : "error"} (${tc.durationMs}ms)`,
    ),
    "",
    `_block ${verdict.meta.block} · coverage ${verdict.coverage.kind} · ${evidence.roundsUsed} analyzer round${evidence.roundsUsed === 1 ? "" : "s"} · ${(verdict.meta.durationMs / 1000).toFixed(1)}s · ${verdict.meta.tracer}_`,
    "",
  );
  return lines.join("\n");
}

export function writeAgentOutputs(report: AgentReport, outDir: string): readonly string[] {
  mkdirSync(outDir, { recursive: true });
  const files = [
    ["agent-report.json", `${JSON.stringify(report, null, 2)}\n`],
    ["verdict-report.md", formatVerdictReport(report)],
    ["verdict.json", `${JSON.stringify(report.verdict, null, 2)}\n`],
    [
      "contract-storage-tracer.json",
      `${JSON.stringify(report.tools.contractStorageTracer, null, 2)}\n`,
    ],
    ["contract-storage-tracer.log", `${report.tools.contractStorageTracerLog.join("\n")}\n`],
  ] as const;
  return files.map(([name, data]) => {
    const path = join(outDir, name);
    writeFileSync(path, data);
    return path;
  });
}
