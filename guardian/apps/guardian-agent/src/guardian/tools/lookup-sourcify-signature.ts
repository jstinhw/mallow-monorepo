import { isHex, size, type Hex } from "viem";
import { lookupSignature } from "../../sourcify/client";
import type { GuardianTool, OpenAIToolSchema, ToolExecuteResult } from "./types";
import { truncate } from "./text";

type LookupArgs = { selector: Hex };
type LookupResult = { selector: Hex; signatures: string[] };

const schema: OpenAIToolSchema = {
  type: "function",
  function: {
    name: "lookup_sourcify_signature",
    description:
      "Resolve a 4-byte selector to candidate function signatures via Sourcify. Answers: what could this unknown selector be? Use when probing a selector discovered inside a trace; for top-level calldata prefer decode_calldata which also returns decoded args.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["selector"],
      properties: {
        selector: { type: "string", pattern: "^0x[0-9a-fA-F]{8}$" },
      },
    },
  },
};

function parseArgs(raw: unknown): LookupArgs | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isHex(obj.selector) || size(obj.selector) !== 4) return null;
  return { selector: obj.selector };
}

async function execute(args: LookupArgs): Promise<ToolExecuteResult<LookupResult>> {
  const signatures = await lookupSignature(args.selector);
  return { ok: true, result: { selector: args.selector, signatures } };
}

const _executeWithCtx: GuardianTool<LookupArgs, LookupResult>["execute"] = (args) => execute(args);

function summarizeResult(
  _args: LookupArgs | null,
  result: LookupResult | { error: string },
  ok: boolean,
): string {
  if (!ok || "error" in result) {
    const msg = "error" in result ? result.error : "lookup failed";
    return truncate(`Failed: ${msg}`);
  }
  if (result.signatures.length === 0) return `No matches for ${result.selector}`;
  if (result.signatures.length === 1) return truncate(`Found: ${result.signatures[0]}`);
  return truncate(`Found ${result.signatures.length}: ${result.signatures[0]}`);
}

export const lookupSourcifySignatureTool: GuardianTool<LookupArgs, LookupResult> = {
  name: schema.function.name,
  openaiToolSchema: schema,
  plannerHint:
    "lookup_sourcify_signature — answers: what is this 4-byte selector? Use when: probing a selector found inside a trace (e.g. inner sub-call). Cost: fast.",
  interpretationGuide: `## Skill: interpret lookup_sourcify_signature

signatures (string[]) — candidate signatures.
[] → unknown selector; the contract is doing something not catalogued by Sourcify. Elevated risk if this is the top-level call; expected for some inner calls.
length 1 → high-confidence match.
length > 1 → collision. Pick the candidate whose argument shape matches the call site you found the selector at.`,
  friendlyLabel: "Looked up signature",
  summarizeResult,
  parseArgs,
  execute: _executeWithCtx,
};
