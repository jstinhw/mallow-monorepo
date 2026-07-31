import type { GuardianInput } from "../../protocol";
import { callGuardianLLM } from "../../llm/client";
import type { GuardianSummaryDelta } from "../../llm/client";
import type { GuardianActionPlan, GuardianLLMOutput } from "../../llm/schema";
import { interpretationGuides } from "../tools/registry";
import type { EvidenceBundle } from "../tools/types";

export type SummarizerCfg = { baseUrl: string; apiKey: string; model: string };

const SYSTEM = (): string =>
  `
You are mallow's Guardian. The reader of your output is a non-developer who is about to sign a transaction. They should finish reading and feel they understand what is happening and whether it is safe. Concrete amounts and named entities beat adjectives. Honest uncertainty beats false comfort.

${interpretationGuides()}

## Naming (REQUIRED — read first)

Name the specific asset and counterparty. The evidence often identifies them exactly — the analyzer summary, the contract name (e.g. "FiatTokenProxy" = Circle's USDC), or decoded args. When the identity is established anywhere in the evidence, you MUST carry it forward by its symbol/name in BOTH summary and reasoning.

NEVER downgrade a known asset to a generic phrase. If the evidence shows the token is USDC, write "USDC" — not "ERC-20 token", "the token", or "an ERC-20 transfer". Same for counterparties: name the contract (e.g. "Circle's verified USDC contract") rather than "a contract". Only fall back to generic language when the evidence genuinely fails to identify the entity, and say so plainly.

When token decimals are known (USDC = 6, most ERC-20 = 18), convert raw amounts to human units alongside the raw value, e.g. "1000 units (0.001 USDC)".

## Output expectations

summary (20–320 chars, 1–2 sentences):
  The headline. State what the tx does with the concrete amount, the named token, the named counterparty, and its verification status — everything the reader needs to grasp the transaction at a glance. No filler like "this transaction…". Examples:
  - "Transfers 1000 USDC (raw units) to 0xE0fB…89eF via Circle's verified USDC contract on Base — a clean transfer with no approvals."
  - "Approves Uniswap v3 Router to spend exactly 250 USDC."
  - "Sends 0.42 ETH to a wallet your account has never interacted with."
  - "Calls an unverified contract that self-destructs mid-trace. Do not sign."

impacts (1–6 bullets, each 6–160 chars):
  The concrete consequences after signing. Human units and named tokens (USDC, ETH, NFT count) — not wei, not "ERC-20 token". If the simulation reverts, lead with that.

reasoning (60–800 chars, 3–6 short sentences):
  Tight and factual. Every sentence must cite a specific observation from the evidence (decoded args, contract name + verification status, simulation result, finding id). Name the token and counterparty (see Naming above) — never "ERC-20 token". The last sentence states the risk level and the single most important reason. Quote exact numbers from tool outputs (amounts, addresses, gas).

  Avoid hand-wavy padding that adds no information ("it appears that", "in summary", "seems to" used as filler). When uncertainty IS the truth, name what you don't know plainly: "Etherscan has no source for this contract, so I can't confirm what it does internally." Stating a limit is honest, not hedging.

  If a critical piece of evidence is missing (no simulation, no contract metadata, decode failed), call it out in reasoning AND raise risk by one level unless other evidence rules it out. Do not paper over gaps.

  Good example: "Calldata decodes as approve(address,uint256) with amount 250000000 (250 USDC at 6 decimals). The spender is Uniswap V3 SwapRouter02, verified on Etherscan. Anvil simulation succeeds in 46823 gas with a single Approval event and no nested calls. Risk low: the allowance is bounded and the spender is a known router."

## How to combine evidence into a verdict

1. Asset impact first: state the net effect on the user (ETH sent, tokens sent, approvals granted, NFTs moved) in impacts[].
2. Intent vs execution: compare what the decoded calldata claims to do against what the simulation actually did. Any divergence raises risk.
3. Trust signals: verified + known name lowers risk; unverified + unknown name raises it but does not alone justify "critical". Simulation is ground truth; weight it over static metadata.
4. Drainer patterns: user sends value/tokens but receives nothing; unexpected delegatecall chains; approval granted inside a swap call; NFT approvals buried in a multicall.
5. Risk calibration:
   info     — read-only call, no asset movement, no approval, verified target
   low      — small ETH send to EOA or well-known verified contract; normal DEX swap where simulation confirms tokens arrive at the user's own address
   medium   — unverified target, unexpected recipients, simulation anomalies, missing critical evidence; AMM reserve-sync (function resets pair reserves to match actual balances, locking in a manipulated price after a donation — confirmed by reading contract source); direct large token transfer into an AMM pair contract (not via a router)
   high     — unlimited ERC-20 approval (EIP-20 approve with max uint), setApprovalForAll (EIP-721), unverified proxy, ETH loss exceeds declared amount, SELFDESTRUCT; swap/DeFi call where the output recipient is a contract not the user's address; permissionless function whose source code burns an AMM pair's token reserves (no access control + reduces pair balance — confirmed by reading contract source); simulation shows ≥2 ERC-20 Transfer events to address(0); simulation shows user's tokens leave but nothing returns
   critical — drainer pattern confirmed (simulation proves user loses funds), delegatecall to unknown, user's entire balance at risk; combination of reserve manipulation + drain confirmed in simulation

Respond with JSON matching the provided schema.
`.trim();

export function buildSummarizerPrompt(args: {
  input: GuardianInput;
  evidence: EvidenceBundle;
  plan: GuardianActionPlan;
}): string {
  const { input, evidence, plan } = args;
  const lines: string[] = [];
  let txDesc = `tx: chainId=${input.chainId} from=${input.from} to=${input.to} value=${input.value.toString()} wei`;
  if (input.typedData) {
    txDesc += ` (EIP-712 Signature Request, verifyingContract=${input.to}, primaryType=${input.typedData.primaryType})`;
  }
  lines.push(txDesc);
  if (input.typedData) {
    lines.push(`typedData message details: ${JSON.stringify(input.typedData.message)}`);
  }
  lines.push(`planner reasoning: ${plan.reasoning}`);
  lines.push(`analyzer summary: ${evidence.analyzerReasoning || "(no text summary)"}`);
  lines.push(
    `analyzer used ${evidence.roundsUsed} round(s) and called ${evidence.toolCalls.length} tool(s).`,
  );
  lines.push("");
  lines.push("evidence (tool calls in order):");
  for (const tc of evidence.toolCalls) {
    const args = safeStringify(tc.args);
    const result = safeStringify(tc.result);
    lines.push(`- round ${tc.round} ${tc.name}(${args})${tc.ok ? "" : " [error]"}`);
    lines.push(`  result: ${truncate(result, 600)}`);
  }
  lines.push("");
  lines.push("rule-based findings (deterministic; verdict risk must be ≥ max(rule severities)):");
  if (evidence.findings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of evidence.findings) {
      lines.push(`  - [${f.severity}] ${f.id}: ${f.title}`);
    }
  }
  lines.push("");
  lines.push("identified entities (reuse these exact names — do NOT generalize them):");
  lines.push(`  primary contract: ${describeContract(evidence.contract)}`);
  lines.push(`  decoded call: ${describeDecoded(evidence.decoded)}`);
  lines.push(
    'The analyzer summary above already names the token/counterparty when known. Carry those names through into summary and reasoning verbatim — never replace a named token with "ERC-20 token".',
  );
  return lines.join("\n");
}

function describeContract(c: EvidenceBundle["contract"]): string {
  if (!c) return "(not probed)";
  const parts = [
    c.name ? `name=${c.name}` : "name=unknown",
    c.verified ? "verified" : "unverified",
  ];
  if (c.isProxy) parts.push(c.implementation ? `proxy→${c.implementation}` : "proxy");
  return parts.join(", ");
}

function describeDecoded(d: EvidenceBundle["decoded"]): string {
  if (!d) return "(not decoded)";
  return d.signature ? `${d.signature} (selector ${d.selector})` : `selector ${d.selector}`;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "<unstringifiable>";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…(truncated)";
}

export async function runSummarizer(args: {
  cfg: SummarizerCfg;
  input: GuardianInput;
  evidence: EvidenceBundle;
  plan: GuardianActionPlan;
  onDelta?: (d: GuardianSummaryDelta) => void;
}): Promise<GuardianLLMOutput | null> {
  return callGuardianLLM({
    baseUrl: args.cfg.baseUrl,
    apiKey: args.cfg.apiKey,
    model: args.cfg.model,
    system: SYSTEM(),
    user: buildSummarizerPrompt(args),
    onDelta: args.onDelta,
  });
}
