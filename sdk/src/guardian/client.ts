import type { GuardianProgress, GuardianRequest, GuardianVerdict } from './types.js';

export class GuardianError extends Error {
  override readonly name = 'GuardianError';
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * The slice of `fetch` this client uses. Deliberately narrower than
 * `typeof globalThis.fetch`, whose overloads differ between lib.dom and
 * @types/node — a plain function is assignable to this from either.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GuardianClientConfig = {
  /** Base URL of the guardian-agent service, e.g. `http://localhost:3003`. */
  url: string;
  /** Injectable for tests / non-browser runtimes. Defaults to global `fetch`. */
  fetch?: FetchLike;
};

export type CheckOptions = {
  onProgress?: (event: GuardianProgress) => void;
  signal?: AbortSignal;
};

type SseMessage = { event: string; data: string };

/**
 * Parse an SSE byte stream into `{ event, data }` messages. Split out from
 * `check` so the framing logic is testable without a live service — chunk
 * boundaries do not respect message boundaries, so the trailing partial block
 * is carried into the next read.
 */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const message = parseBlock(block);
        if (message) yield message;
        split = buffer.indexOf('\n\n');
      }
    }
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

/**
 * Client for the Guardian transaction-safety agent. `check` streams the agent's
 * progress and resolves with its final verdict.
 *
 * ```ts
 * const guardian = createGuardianClient({ url: 'http://localhost:3003' })
 * const verdict = await guardian.check(request, {
 *   onProgress: (e) => console.log(e.stage),
 * })
 * ```
 */
export function createGuardianClient(config: GuardianClientConfig) {
  const doFetch: FetchLike | undefined = config.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new GuardianError('no fetch implementation available; pass one via `config.fetch`');
  }
  const endpoint = new URL('/check', config.url).toString();

  return {
    async check(request: GuardianRequest, options: CheckOptions = {}): Promise<GuardianVerdict> {
      const body = JSON.stringify({
        chainId: request.chainId,
        from: request.from,
        to: request.to,
        value: request.value.toString(),
        data: request.data,
        ...(request.typedData ? { typedData: request.typedData } : {}),
      });

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        throw new GuardianError(`guardian service unreachable at ${endpoint}`, error);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new GuardianError(
          `guardian service returned ${response.status}: ${detail || response.statusText}`,
        );
      }
      if (!response.body) {
        throw new GuardianError('guardian service returned no stream');
      }

      let verdict: GuardianVerdict | undefined;
      for await (const message of parseSse(response.body)) {
        let payload: unknown;
        try {
          payload = JSON.parse(message.data);
        } catch (error) {
          throw new GuardianError(`malformed ${message.event} event from guardian`, error);
        }
        if (message.event === 'error') {
          const detail =
            typeof payload === 'object' && payload && 'message' in payload
              ? String((payload as { message: unknown }).message)
              : 'unknown error';
          throw new GuardianError(`guardian analysis failed: ${detail}`);
        }
        if (message.event === 'verdict') verdict = payload as GuardianVerdict;
        else if (message.event === 'progress') options.onProgress?.(payload as GuardianProgress);
      }

      if (!verdict) {
        throw new GuardianError('guardian stream ended before a verdict was sent');
      }
      return verdict;
    },
  };
}

export type GuardianClient = ReturnType<typeof createGuardianClient>;
