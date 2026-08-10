export interface BackoffOptions {
  /** Retry attempts after the first try. */
  readonly retries?: number;
  /** Base delay in ms; doubles each retry, with jitter. */
  readonly baseMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchFn?: typeof fetch;
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/** Fetches with exponential backoff + jitter on network errors and 429/5xx responses. */
export async function fetchWithBackoff(
  input: string,
  init?: RequestInit,
  opts: BackoffOptions = {},
): Promise<Response> {
  const { retries = 3, baseMs = 250, fetchFn = fetch } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(input, init);
      if (res.ok || attempt >= retries || !isRetryableStatus(res.status)) return res;
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    // An abort is a decision, not a flaky network: retrying it would hold the caller's
    // resources for three more round-trips after they already gave up.
    if (init?.signal?.aborted) throw new Error("request aborted");
    const delay = baseMs * 2 ** attempt * (0.5 + Math.random() * 0.5);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
