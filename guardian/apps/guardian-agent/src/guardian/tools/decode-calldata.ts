import { isHex, size, type Hex } from "viem";
import { abiDecode, fourByteDecode } from "../../cast";
import { lookupSignature } from "../../sourcify/client";
import { selectorFindings } from "../finders/selectors";
import type { GuardianTool, OpenAIToolSchema, ToolContext, ToolExecuteResult } from "./types";
import { truncate } from "./text";

type DecodeArgs = { data?: Hex };

type DecodeResult = {
  selector: Hex;
  signature?: string;
  args?: unknown[];
  source: "4byte" | "sourcify" | "none" | "empty";
};

const schema: OpenAIToolSchema = {
  type: "function",
  function: {
    name: "decode_calldata",
    description:
      "Resolve the 4-byte function selector and decode typed arguments. Answers: what function is being called and with what arguments? Tries cast's local 4byte DB first, then Sourcify. Defaults to the tx's own calldata; pass `data` to decode inner calldata discovered inside a trace.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        data: {
          type: "string",
          description: "Optional hex calldata override. Omit to decode the tx's own calldata.",
          pattern: "^0x[0-9a-fA-F]*$",
        },
      },
    },
  },
};

function parseArgs(raw: unknown): DecodeArgs | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.data === undefined) return {};
  if (!isHex(obj.data)) return null;
  return { data: obj.data };
}

async function execute(
  args: DecodeArgs,
  ctx: ToolContext,
): Promise<ToolExecuteResult<DecodeResult>> {
  const data = (args.data ?? ctx.input.data) as Hex;
  if (data === "0x") {
    const decoded = { selector: "0x" as Hex };
    if ((args.data ?? ctx.input.data) === ctx.input.data) ctx.lastDecoded = decoded;
    return { ok: true, result: { selector: "0x" as Hex, source: "empty" } };
  }
  if (data.length < 10) {
    return { ok: false, error: "calldata too short to contain a selector" };
  }
  const selector = data.slice(0, 10) as Hex;
  if (!isHex(selector) || size(selector) !== 4)
    return { ok: false, error: `invalid selector ${selector}` };

  let source: DecodeResult["source"] = "none";
  let signature: string | undefined;
  const localSigs = await fourByteDecode(selector);
  if (localSigs?.[0]) {
    signature = localSigs[0];
    source = "4byte";
  } else {
    const remote = await lookupSignature(selector);
    if (remote[0]) {
      signature = remote[0];
      source = "sourcify";
    }
  }

  let decodedArgs: unknown[] | undefined;
  if (signature) {
    try {
      decodedArgs = await abiDecode(signature, data);
    } catch {
      decodedArgs = undefined;
    }
  }

  const isTopLevel = (args.data ?? ctx.input.data) === ctx.input.data;
  if (isTopLevel) {
    ctx.lastDecoded = { selector, signature, args: decodedArgs };
    ctx.findings.push(...selectorFindings({ selector, signature, data }));
  }

  return { ok: true, result: { selector, signature, args: decodedArgs, source } };
}

function summarizeResult(
  _args: DecodeArgs | null,
  result: DecodeResult | { error: string },
  ok: boolean,
): string {
  if (!ok || "error" in result) {
    const msg = "error" in result ? result.error : "decode failed";
    return truncate(`Failed: ${msg}`);
  }
  if (result.source === "empty") return "No calldata (plain ETH transfer)";
  if (!result.signature) return `Unknown selector ${result.selector}`;
  return truncate(result.signature);
}

export const decodeCalldataTool: GuardianTool<DecodeArgs, DecodeResult> = {
  name: schema.function.name,
  openaiToolSchema: schema,
  plannerHint:
    "decode_calldata — answers: what function is being called and with what arguments? Use when: data is not 0x. Cost: fast.",
  interpretationGuide: `## Skill: interpret decode_calldata

selector (hex) — the 4-byte function ID.
signature (string|undefined) — canonical Solidity signature, e.g. \`approve(address,uint256)\`. Multiple candidates collide on the same selector; prefer the one matching the simulated call shape.
args (unknown[]|undefined) — decoded arguments in signature order. Inspect them with the signature in hand; \`uint256\` values are raw integers (no decimal scaling).
source — '4byte' (local), 'sourcify' (remote), 'none' (unknown selector), 'empty' (no calldata).
What it means:
- 'empty' → plain ETH transfer.
- 'none' → unknown selector; treat as elevated risk and consider \`lookup_sourcify_signature\` for clues.
- A common selector (0xa9059cbb=transfer, 0x095ea7b3=approve) with args you can quote directly is a high-confidence static signal — confirm it against the simulation when available.
Dangerous signature patterns to flag in reasoning:
- approve(_, 2^256-1 or large) → infinite/oversized ERC-20 allowance.
- setApprovalForAll(_, true) → unbounded NFT approval to a third party.
- transferFrom(from=user, _, _) → user is the source; require user to have approved the spender.
- permit / permit2 → off-chain-signed approval bundled with on-chain spend; check the spender + deadline.
- multicall / execute → inner calldata can hide effects; probe each inner selector with lookup_sourcify_signature.
- sync() / skim() on an AMM pair → forces reserve accounting; often used before a price-manipulation drain.
- Any swap function (e.g. swapExact*, swap, exactInput*) where the \`to\`/recipient argument is a contract address other than the user's own address → output tokens go to that contract, user receives nothing. Flag HIGH.
- triggerAutoBurn, autoBurn, burnFromPool, triggerBurn or similar permissionless burn functions on a token contract → these crash the token's AMM reserve price; flag HIGH and verify in simulation.`,
  friendlyLabel: "Decoded the call",
  summarizeResult,
  parseArgs,
  execute,
};
