import { opaqueHypothesisSchema, type OpaqueHypothesisResult } from "../../schemas/llm";
import type { ModelProvider } from "../provider";

/**
 * Advisory hypotheses for opaque routes: where the deterministic recursion classified a route's
 * key-argument provenance as opaque (derived from storage/computation) or a trace-enumerated
 * role set, ask the model who controls that value. Output is tagged `provenance:"hypothesis"` and
 * never treated as verified — it never changes a `Boundedness` or a `CallChain`.
 */
export interface OpaqueRouteInput {
  readonly contract: string;
  readonly functionName: string;
  readonly note: string;
  readonly sourceSlice: string;
}

const SYSTEM =
  "For each Solidity entrypoint below, a traced value's provenance is opaque (it derives from " +
  "storage or computation, not directly from the caller). Hypothesize who controls it: a role " +
  "holder, a registry/config, a signer (e.g. permit), or anyone. This is a HYPOTHESIS, not a " +
  'verified fact. Respond with ONLY JSON of the form {"hypotheses":[{"route","controller",' +
  '"confidence","explanation","suggestedCheck"}]}. route must echo the given "Contract.function". ' +
  "confidence is one of high|medium|low. suggestedCheck (optional) is how to verify on-chain.";

function userPrompt(routes: readonly OpaqueRouteInput[]): string {
  return routes
    .map(
      (r) =>
        `Route ${r.contract}.${r.functionName} — ${r.note}\nSource (truncated):\n${r.sourceSlice.slice(0, 2500)}`,
    )
    .join("\n\n---\n\n");
}

/** Runs opaque-route hypothesis; returns undefined on any failure. */
export async function hypothesizeOpaqueRoutes(
  provider: ModelProvider,
  routes: readonly OpaqueRouteInput[],
): Promise<OpaqueHypothesisResult | undefined> {
  if (routes.length === 0) return { hypotheses: [] };
  try {
    return await provider.respondJson(
      {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(routes) },
        ],
        temperature: 0,
        maxTokens: 1500,
      },
      opaqueHypothesisSchema,
    );
  } catch {
    return undefined;
  }
}
