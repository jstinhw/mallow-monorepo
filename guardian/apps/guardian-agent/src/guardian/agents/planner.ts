import type { GuardianInput } from "../../protocol";
import { callGuardianActionPlanLLM } from "../../llm/client";
import type { GuardianAction, GuardianActionPlan } from "../../llm/schema";
import { ALLOWED_ACTIONS } from "../../llm/schema";
import { plannerHints } from "../tools/registry";

export type PlannerCfg = { baseUrl: string; apiKey: string; model: string };

const SYSTEM = (): string =>
  `
You are mallow's Guardian action planner. You receive a raw Ethereum transaction request and decide which analysis tools should run first. You do not analyze, decode, or write the safety verdict — separate agents do that. Your job: pick a minimum sufficient set of tools so the analyzer can investigate efficiently.

Available tools:
${plannerHints()}

How to choose:
- Plain ETH send (data=0x): \`get_contract_info\` is enough. Its result tells us if the recipient is an EOA or a contract; we don't yet know.
- Contract call with non-trivial calldata: at minimum \`decode_calldata\` + \`get_contract_info\`. Add \`simulate_transaction\` whenever the actual on-chain effect matters (almost always, unless the call is read-only or we're certain it will revert).
- Approval / permit / setApprovalForAll family: always include \`decode_calldata\` + \`simulate_transaction\` so we can quote the exact allowance amount and confirm the spender.
- Unknown selector or obfuscated calldata: include all four tools — \`lookup_sourcify_signature\` gives extra coverage on inner selectors.
- EIP-712 signature request (indicated by typedData is present): choose only \`get_contract_info\` to inspect the verifying contract (\`to\` address) and get its source code/ABI. Do NOT choose \`simulate_transaction\` or \`decode_calldata\` because there is no transaction calldata to simulate or decode.

The analyzer is autonomous and may add tools you skipped, so a small, well-chosen starting set is better than a maximalist one.

Your \`reasoning\` field is shown to the end-user on the review screen as one short, plain-English sentence. Write for a non-developer who is about to sign. Examples:
- "Decoding the call, checking the recipient on Etherscan, and simulating to see what actually moves."
- "Plain ETH transfer — just verifying who the recipient is."
- "Unknown function on an unfamiliar contract — running every check."
Do not name the tools (\`decode_calldata\`, etc.) in your reasoning — use plain English ("decoding the call", "checking the recipient", "simulating").

Respond with JSON matching the provided schema.
`.trim();

export function buildPlannerPrompt(input: GuardianInput): string {
  const lines = [
    `tx request:`,
    `chainId=${input.chainId}`,
    `from=${input.from}`,
    `to=${input.to}`,
    `value=${input.value.toString()} wei`,
    `data=${input.data}`,
  ];
  if (input.typedData) {
    lines.push(
      `typedData (EIP-712):`,
      `  primaryType: ${input.typedData.primaryType}`,
      `  domain: ${JSON.stringify(input.typedData.domain)}`,
      `  message: ${JSON.stringify(input.typedData.message)}`,
    );
  }
  return lines.join("\n");
}

export async function runPlanner(args: {
  cfg: PlannerCfg;
  input: GuardianInput;
}): Promise<GuardianActionPlan | null> {
  return callGuardianActionPlanLLM({
    baseUrl: args.cfg.baseUrl,
    apiKey: args.cfg.apiKey,
    model: args.cfg.model,
    system: SYSTEM(),
    user: buildPlannerPrompt(args.input),
  });
}

export function fallbackPlan(): GuardianActionPlan {
  return {
    actions: [...ALLOWED_ACTIONS] as GuardianAction[],
    reasoning: "Running every check — the planner couldn't reach the model so I'm being thorough.",
  };
}
