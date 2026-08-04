import { anchorTriageSchema, type AnchorTriageResult } from "../../schemas/llm";
import type { ModelProvider } from "../provider";

/**
 * Advisory anchor triage: when a transaction writes several storage variables, rank and label
 * which are security-relevant to the seed's intent. Purely advisory — the deterministic pipeline
 * still traces every written anchor; this only orders their presentation and attaches a label.
 */
export interface AnchorTriageInput {
  readonly contractName: string;
  readonly functionName: string;
  readonly anchors: readonly {
    readonly variable: string;
    readonly type: string;
    readonly path: string;
    readonly access: string;
  }[];
  readonly sourceSlice?: string;
}

const SYSTEM =
  "You rank Solidity storage variables written by one transaction by security relevance " +
  "(funds custody, authorization/roles, upgradeability, accounting). Respond with ONLY a JSON " +
  'object of the form {"rankings":[{"variable","rank","label","rationale","securityRelevance"}]} ' +
  "covering every listed variable exactly once. rank is 1-based (1 = most relevant). " +
  "securityRelevance is one of critical|high|medium|low.";

function userPrompt(input: AnchorTriageInput): string {
  const lines = input.anchors.map(
    (a) => `- ${a.variable} (type ${a.type}, path ${a.path}, access ${a.access})`,
  );
  const slice = input.sourceSlice
    ? `\n\nRelevant source (truncated):\n${input.sourceSlice.slice(0, 4000)}`
    : "";
  return `Contract ${input.contractName}, transaction ${input.functionName}. Written storage variables:\n${lines.join("\n")}${slice}`;
}

/** Runs anchor triage; returns undefined on any failure (unreachable model, bad JSON, schema miss). */
export async function triageAnchors(
  provider: ModelProvider,
  input: AnchorTriageInput,
): Promise<AnchorTriageResult | undefined> {
  try {
    return await provider.respondJson(
      {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(input) },
        ],
        temperature: 0,
        maxTokens: 1024,
      },
      anchorTriageSchema,
    );
  } catch {
    return undefined;
  }
}
