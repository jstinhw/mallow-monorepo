import { envSchema } from "./schemas/env"

/** Recursion bounds for the backward worklist. */
export interface Bounds {
  readonly maxDepth: number
  readonly maxAddresses: number
}

/** Advisory LLM connection. */
export interface LlmConfig {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey?: string
}

/** Every environment-derived setting, read in one place. */
export interface Config {
  readonly bounds: Bounds
  /** External address-tagging service (see `acquire/tagging`). */
  readonly tagServiceUrl?: string
  readonly traceLog: boolean
  readonly llm?: LlmConfig
}

/**
 * Reads every environment-derived setting once: recursion bounds (`MAX_DEPTH`,
 * `MAX_ADDRESSES`), `ALCHEMY_API_KEY`, `TAG_SERVICE_URL`, `TRACE_LOG`, and the `LLM_*`
 * connection. Callers get plain values back and never touch `process.env` themselves.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env)
  const llm = e.LLM_BASE_URL
    ? { baseUrl: e.LLM_BASE_URL, model: e.LLM_MODEL, ...(e.LLM_API_KEY ? { apiKey: e.LLM_API_KEY } : {}) }
    : undefined
  return {
    bounds: { maxDepth: e.MAX_DEPTH, maxAddresses: e.MAX_ADDRESSES },
    ...(e.TAG_SERVICE_URL ? { tagServiceUrl: e.TAG_SERVICE_URL } : {}),
    traceLog: e.TRACE_LOG !== "0",
    ...(llm ? { llm } : {}),
  }
}
