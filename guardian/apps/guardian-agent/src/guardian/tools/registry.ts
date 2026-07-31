import { decodeCalldataTool } from "./decode-calldata";
import { getContractInfoTool } from "./get-contract-info";
import { simulateTransactionTool } from "./simulate-transaction";
import { lookupSourcifySignatureTool } from "./lookup-sourcify-signature";
import type { AnyGuardianTool, OpenAIToolSchema } from "./types";

const TOOLS: AnyGuardianTool[] = [
  decodeCalldataTool as unknown as AnyGuardianTool,
  getContractInfoTool as unknown as AnyGuardianTool,
  simulateTransactionTool as unknown as AnyGuardianTool,
  lookupSourcifySignatureTool as unknown as AnyGuardianTool,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const TOOL_NAMES = TOOLS.map((t) => t.name) as readonly string[];

export function byName(name: string): AnyGuardianTool | null {
  return BY_NAME.get(name) ?? null;
}

export function all(): readonly AnyGuardianTool[] {
  return TOOLS;
}

export function openaiToolsArray(): OpenAIToolSchema[] {
  return TOOLS.map((t) => t.openaiToolSchema);
}

export function plannerHints(): string {
  return TOOLS.map((t) => `- ${t.plannerHint}`).join("\n");
}

export function interpretationGuides(): string {
  return TOOLS.map((t) => t.interpretationGuide).join("\n\n");
}
