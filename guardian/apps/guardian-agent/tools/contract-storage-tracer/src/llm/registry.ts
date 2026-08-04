import type { LlmConfig } from "../config";
import type { ModelProvider } from "./provider";
import { createOpenAiCompatProvider } from "./openai-compat";

/** An advisory model service: one provider plus a reachability probe. */
export interface LlmService {
  readonly provider: ModelProvider;
  reachable(): Promise<boolean>;
}

/** Builds the advisory model service from `llmConfig`. One provider instance is shared across tasks. */
export function loadLlmService(llmConfig: LlmConfig, fetchFn: typeof fetch = fetch): LlmService {
  const provider = createOpenAiCompatProvider({
    name: "local",
    baseUrl: llmConfig.baseUrl,
    model: llmConfig.model,
    ...(llmConfig.apiKey ? { apiKey: llmConfig.apiKey } : {}),
    fetchFn,
  });
  return { provider, reachable: () => probeReachable(llmConfig.baseUrl, 1500, fetchFn) };
}

/**
 * Probes whether an OpenAI-compatible server is reachable (`GET {baseUrl}/models`), with a short
 * timeout. Advisory tasks call this once and silently skip when it fails, so an unreachable or
 * unconfigured model never blocks or breaks a trace.
 */
export async function probeReachable(
  baseUrl: string,
  timeoutMs = 1500,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
