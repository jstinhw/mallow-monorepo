import type { Hex } from "viem";
import type { ContractInfo, Finding, GuardianInput } from "../../protocol";
import { callGuardianAnalyzerLLM, type AnalyzerMessage, type ToolCallSpec } from "../../llm/client";
import type { GuardianActionPlan } from "../../llm/schema";
import { byName, interpretationGuides, openaiToolsArray } from "../tools/registry";
import { classifySignature } from "../signature";
import type { EvidenceBundle, ToolCallRecord, ToolContext } from "../tools/types";

export type AnalyzerCfg = {
  baseUrl: string;
  apiKey: string;
  model: string;
  rpcUrl: string;
  etherscanKey: string;
};

export type ToolStartInfo = {
  callId: string;
  round: number;
  label: string;
};

export type ToolCompleteInfo = {
  callId: string;
  round: number;
  label: string;
  ok: boolean;
  durationMs: number;
  summary: string;
};

export type ThinkingInfo = {
  round: number;
  intent: string;
};

export type AnalyzerInput = {
  input: GuardianInput;
  plan: GuardianActionPlan;
  cfg: AnalyzerCfg;
  ctx: ToolContext;
  onToolStart?: (e: ToolStartInfo) => void;
  onToolComplete?: (e: ToolCompleteInfo) => void;
  onThinking?: (e: ThinkingInfo) => void;
  maxRounds?: number;
};

const DEFAULT_MAX_ROUNDS = 5;

const SYSTEM = (): string =>
  `
You are mallow's Guardian analyzer. You investigate Ethereum transactions by calling tools and gathering evidence for a downstream summarizer. You do NOT write the user-facing verdict yourself.

${interpretationGuides()}

How to investigate:
1. Start with the planner's suggested tools. Adapt as you learn — you may call tools the planner didn't suggest, and skip ones that no longer make sense.
2. Call independent tools in parallel within one turn (one assistant message can issue multiple \`tool_calls\`). Most investigations chain: decode_calldata → understand intent; get_contract_info → trust signal; simulate_transaction → ground truth.
3. Probe new addresses with get_contract_info; probe unknown selectors with decode_calldata (passing data) or lookup_sourcify_signature.
4. If this is an EIP-712 signature request (indicated by typedData is present), the verifying contract address is in the \`to\` parameter. Read the verifying contract using \`get_contract_info\` to inspect its verified name, ABI, and implementation. CRUCIALLY, also \`get_contract_info\` on the SPENDER/operator address (the party the signature grants power to — e.g. \`message.spender\`, or the token in \`message.details.token\` / \`message.permitted.token\`): that is *where the signature can be used*, and an unknown or unverified spender is the main risk. Determine what happens when the user signs (e.g. permitting a spender to transfer tokens, authorizing a one-time transfer, listing an NFT) and whether the amount is bounded or unlimited. Since there is no transaction calldata, do not call \`simulate_transaction\` or \`decode_calldata\`.
5. AMM and DeFi manipulation — these attacks use VERIFIED contracts. Detect by what the source code DOES, never by function name or selector:
   - **Source code is the ground truth**: \`get_contract_info\` returns a \`sourceSnippet\` field containing the verified Solidity source of the called function (and its context). Read it carefully — access control modifiers (\`onlyOwner\`, \`require(msg.sender == owner)\`, role checks), reserve state mutations (\`reserve0\`, \`reserve1\`, \`_update\`), and burn operations (\`_burn\`, \`Transfer(sender, address(0), amount)\`) are visible in the source. An attacker can rename any function; the CODE is what matters.
   - **Swap with non-user recipient**: If \`decode_calldata\` reveals a swap/DeFi function where the output recipient parameter is a smart contract address that is NOT the user's own address, flag HIGH. The purchased tokens go to a contract the user may not control.
   - **Permissionless functions that burn pair reserves**: Call \`get_contract_info\` on the called contract. In the returned \`sourceSnippet\`, check: (a) does the function have NO access control (no \`onlyOwner\`, no role modifier, no \`require(msg.sender ==\`)? AND (b) does the function call \`_burn\`, emit \`Transfer(pair, address(0), amount)\`, or otherwise reduce the pair's token balance? If both, that is HIGH regardless of the function's name or what the simulation shows. **The absence of burn events in simulation does NOT downgrade this finding** — if the pair has already been drained, simulation will succeed with no burns, yet the code capability is still dangerous to any user. Read the source; the capability is the risk.
   - **AMM reserve synchronization after a donation**: Call \`get_contract_info\` on the called contract. In the returned \`sourceSnippet\` (or abiSelectors), check: does the contract expose \`reserve0()\`/\`reserve1()\`, \`getReserves()\`, and a \`Sync\` event? If yes, it is an AMM pair. Does the called function reset those reserve state variables to match actual token balances (calls \`_update(balanceOf...\`)? That is a reserve sync — flag MEDIUM regardless of simulation outcome. The function name does not matter; the reserve-reset logic is the signal.
   - **Direct token transfer into a DEX pair**: When \`decode_calldata\` shows a plain ERC-20 transfer (selector 0xa9059cbb), you MUST extract the recipient address from the decoded args and call \`get_contract_info\` on THAT RECIPIENT — not the token contract. If the recipient exposes \`reserve0()\`, \`getReserves()\`, or \`Sync\` in its abiSelectors, it IS an AMM pair. Tokens sent directly to a pair (not via a router) inflate the pair's real balance without updating stored reserves — a price-manipulation setup. Flag MEDIUM. This check is REQUIRED for every ERC-20 transfer call.
   - **Simulation shows tokens out, nothing in**: If the simulation shows ERC-20 tokens leaving the user's address but no tokens or ETH arriving back (and this is not a simple transfer call), that is a drainer pattern — HIGH risk.
6. Hard cap: at most {{MAX_ROUNDS}} rounds. A round = one assistant turn. Parallel tool_calls in the same turn share that round.

Stop calling tools when you can state, with evidence:
(a) the user's net asset impact,
(b) the verification/known-name status of the primary counterparty,
(c) whether the simulated execution matches the stated intent (or the signature authorizes safe actions).
(d) **DeFi manipulation pre-stop checklist** — before stopping on any contract call, answer these three:
    - Is the target contract an AMM pair (confirmed by source code with reserve state variables, Sync event)? If yes: does the called function update/reset those reserves? → MEDIUM at minimum.
    - Is the target a token contract with a permissionless external function that reads pair balance and burns to address(0)? → HIGH. Simulation result does NOT affect this verdict.
    - Is a plain ERC-20 transfer() call sending tokens to an AMM pair address? → MEDIUM. Call get_contract_info on the decoded recipient before answering this.

When you stop, respond with no tool_calls and a short text summary of what you found (forwarded to the summarizer as a hint).

REQUIRED — on every assistant turn, your \`content\` field must NOT be null. The UI shows it to the user in real time.
- On a tool-call turn: a single short plain-English sentence (≤120 chars) describing what question THIS turn is meant to answer. Examples:
  - "Decoding the function call to see what's being requested."
  - "The trace called an unknown selector inside Uniswap — looking it up."
  - "Verifying the recipient on Etherscan now that I know it's a contract."
- On the stopping turn (no tool_calls): a 2–3 sentence findings summary the downstream summarizer can use as a hint. This is your last chance to record what you concluded.
Write for a non-developer. Do not include tool names in tool-call-turn intents. Each tool call adds 1–5 seconds the user waits — prefer the minimum set that lets you characterize the transaction.
`.trim();

export function buildAnalyzerPrompt(input: GuardianInput, plan: GuardianActionPlan): string {
  const lines = [
    `tx:`,
    `  chainId=${input.chainId}`,
    `  from=${input.from}`,
    `  to=${input.to}`,
    `  value=${input.value.toString()} wei`,
    `  data=${input.data.length > 200 ? input.data.slice(0, 200) + "…(truncated)" : input.data}`,
  ];
  if (input.typedData) {
    lines.push(
      `  typedData (EIP-712):`,
      `    primaryType: ${input.typedData.primaryType}`,
      `    domain: ${JSON.stringify(input.typedData.domain)}`,
      `    message: ${JSON.stringify(input.typedData.message)}`,
    );
    const sig = classifySignature(input);
    lines.push(
      `  Guardian classified this signature as: ${sig.kind} — ${sig.outcome}`,
      `  verifyingContract to inspect: ${sig.verifyingContract ?? input.to}`,
      ...(sig.spender
        ? [`  spender/operator to inspect (where the signature can be used): ${sig.spender}`]
        : []),
      ...(sig.token ? [`  token whose movement is authorized: ${sig.token}`] : []),
    );
  }
  lines.push(
    ``,
    `planner suggested tools: ${plan.actions.join(", ")}`,
    `planner reasoning: ${plan.reasoning}`,
    ``,
    `Begin by issuing tool_calls.`,
  );
  return lines.join("\n");
}

function truncateIntent(s: string): string {
  const cleaned = s.replace(/^["'`\s]+/, "").trim();
  return cleaned.length <= 120 ? cleaned : cleaned.slice(0, 117).trimEnd() + "…";
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function previewArgs(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return "<unprintable>";
  }
}

function rawSelector(data: Hex): Hex {
  return data === "0x" ? ("0x" as Hex) : (data.slice(0, 10) as Hex);
}

// Reasoning models often leave `content` empty and put the narrative in
// `reasoning_content` — particularly when truncated (finish_reason "length").
// Prefer the clean content, but fall back so the user still sees the full text.
function assistantText(m: { content: string | null; reasoning_content?: string | null }): string {
  const content = (m.content ?? "").trim();
  if (content) return content;
  return (m.reasoning_content ?? "").trim();
}

// Split a final assistant turn into the user-facing prose (the "full read") and
// the step-by-step thinking (powers "How Guardian checked this"). When `content`
// is empty we fall back to reasoning for the prose, so we drop `thinking` then to
// avoid showing the same text in both places.
function captureNarrative(m: { content: string | null; reasoning_content?: string | null }): {
  full: string;
  thinking: string;
} {
  const content = (m.content ?? "").trim();
  const thinking = (m.reasoning_content ?? "").trim();
  return { full: content || thinking, thinking: content ? thinking : "" };
}

export async function runAnalyzer(args: AnalyzerInput): Promise<EvidenceBundle> {
  const maxRounds = args.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const tools = openaiToolsArray();
  const systemContent = SYSTEM().replace("{{MAX_ROUNDS}}", String(maxRounds));
  const messages: AnalyzerMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: buildAnalyzerPrompt(args.input, args.plan) },
  ];
  const records: ToolCallRecord[] = [];
  let analyzerReasoning = "";
  let analyzerThinking = "";
  let roundsUsed = 0;
  let terminated = false;

  for (let round = 0; round < maxRounds; round++) {
    roundsUsed = round + 1;
    const { message, finishReason } = await callGuardianAnalyzerLLM({
      baseUrl: args.cfg.baseUrl,
      apiKey: args.cfg.apiKey,
      model: args.cfg.model,
      messages,
      tools,
    });
    messages.push(message);

    const toolCalls = message.tool_calls ?? [];
    if (args.onThinking && toolCalls.length > 0) {
      const raw = assistantText(message);
      const intent = raw ? truncateIntent(raw) : "Picking next checks…";
      args.onThinking({ round, intent });
    }
    if (toolCalls.length === 0) {
      const narrative = captureNarrative(message);
      analyzerReasoning = narrative.full;
      analyzerThinking = narrative.thinking;
      terminated = true;
      break;
    }

    await runToolCalls(
      toolCalls,
      round,
      args.ctx,
      args.onToolStart,
      args.onToolComplete,
      records,
      messages,
    );

    if (finishReason === "error" || finishReason === "length") {
      terminated = true;
      break;
    }
  }

  if (!terminated && records.length > 0 && !analyzerReasoning) {
    args.onThinking?.({
      round: roundsUsed,
      intent: "Reached the round cap — writing my findings.",
    });
    messages.push({
      role: "user",
      content:
        "Round limit reached. Summarize your findings in plain text. Do not call any more tools.",
    });
    const final = await callGuardianAnalyzerLLM({
      baseUrl: args.cfg.baseUrl,
      apiKey: args.cfg.apiKey,
      model: args.cfg.model,
      messages,
      tools: [],
      toolChoice: "none",
    });
    const narrative = captureNarrative(final.message);
    analyzerReasoning = narrative.full;
    analyzerThinking = narrative.thinking;
  }

  return assembleEvidence(
    args.input,
    args.ctx,
    args.ctx.findings,
    records,
    analyzerReasoning,
    analyzerThinking,
    roundsUsed,
  );
}

async function runToolCalls(
  toolCalls: ToolCallSpec[],
  round: number,
  ctx: ToolContext,
  onToolStart: ((e: ToolStartInfo) => void) | undefined,
  onToolComplete: ((e: ToolCompleteInfo) => void) | undefined,
  records: ToolCallRecord[],
  messages: AnalyzerMessage[],
): Promise<void> {
  const results = await Promise.all(
    toolCalls.map(async (tc, parallelIndex) => {
      const callId = `${round}-${parallelIndex}`;
      const tool = byName(tc.function.name);
      const label = tool?.friendlyLabel ?? "Tool call";
      onToolStart?.({ callId, round, label });

      const rawArgs = safeParseJson(tc.function.arguments);
      const start = Date.now();
      let content: unknown;
      let ok = false;
      let parsedArgs: unknown = null;
      if (!tool) {
        content = { error: `unknown tool '${tc.function.name}'` };
        console.error(`[Analyzer] Unknown tool: '${tc.function.name}'`);
      } else {
        parsedArgs = tool.parseArgs(rawArgs);
        if (parsedArgs === null) {
          content = { error: "invalid arguments for tool" };
          console.error(
            `[Analyzer] Invalid arguments for tool '${tc.function.name}':`,
            JSON.stringify(rawArgs),
          );
        } else {
          try {
            const res = await tool.execute(parsedArgs, ctx);
            if (res.ok) {
              content = res.result;
              ok = true;
            } else {
              content = { error: res.error };
              console.error(`[Analyzer] Tool '${tc.function.name}' returned error:`, res.error);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            content = { error: msg };
            console.error(`[Analyzer] Tool '${tc.function.name}' threw unexpected error:`, e);
          }
        }
      }
      const durationMs = Date.now() - start;
      const rec: ToolCallRecord = {
        round,
        name: tc.function.name,
        args: rawArgs,
        result: content,
        durationMs,
        ok,
      };
      records.push(rec);

      const summary = tool
        ? tool.summarizeResult(parsedArgs, content, ok)
        : `Failed: unknown tool '${tc.function.name}'`;
      onToolComplete?.({ callId, round, label, ok, durationMs, summary });
      ctx.onProgress?.({
        kind: "tool_call",
        name: tc.function.name,
        argsPreview: previewArgs(rawArgs),
      });
      return { tc, content };
    }),
  );

  for (const { tc, content } of results) {
    messages.push({
      role: "tool",
      tool_call_id: tc.id,
      content: JSON.stringify(content ?? {}),
    });
  }
}

function assembleEvidence(
  input: GuardianInput,
  ctx: ToolContext,
  findings: Finding[],
  records: ToolCallRecord[],
  analyzerReasoning: string,
  analyzerThinking: string,
  roundsUsed: number,
): EvidenceBundle {
  return {
    toolCalls: records,
    findings: findings.slice(),
    decoded: ctx.lastDecoded ?? { selector: rawSelector(input.data) },
    contract: (ctx.lastContract ?? null) as ContractInfo | null,
    simulation: ctx.lastSimulation ?? null,
    analyzerReasoning,
    analyzerThinking,
    roundsUsed,
  };
}
