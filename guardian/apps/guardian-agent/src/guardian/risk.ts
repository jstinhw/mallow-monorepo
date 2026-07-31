import type { Finding, RiskLevel } from "../protocol";

const ORDER: RiskLevel[] = ["info", "low", "medium", "high", "critical"];

export function maxRisk(levels: (RiskLevel | null | undefined)[]): RiskLevel {
  let max = 0;
  for (const l of levels) {
    const idx = l ? ORDER.indexOf(l) : 0;
    if (idx > max) max = idx;
  }
  return ORDER[max];
}

export function makeFinding(f: Finding): Finding {
  return { ...f, id: f.id.replace(/_/g, "-").toLowerCase() };
}
