import { describe, expect, it, vi } from 'vitest';
import { createGuardianClient, GuardianError, parseSse } from './client.js';
import type { GuardianRequest } from './types.js';

const request: GuardianRequest = {
  chainId: 1,
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: 0n,
  data: '0x',
};

/** Feed a body as N chunks so message framing is exercised across boundaries. */
const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

const mockFetch = (handler: () => Response) =>
  vi.fn(async (_input: string, _init?: RequestInit) => handler());

const respond = (chunks: string[], init: ResponseInit = {}) =>
  mockFetch(() => new Response(streamOf(chunks), { status: 200, ...init }));

describe('parseSse', () => {
  it('reassembles messages split across chunk boundaries', async () => {
    const stream = streamOf([
      'event: progress\nda',
      'ta: {"stage":"plan"}\n\nevent: ver',
      'dict\ndata: {"risk":"low"}\n\n',
    ]);
    const messages = [];
    for await (const message of parseSse(stream)) messages.push(message);
    expect(messages).toEqual([
      { event: 'progress', data: '{"stage":"plan"}' },
      { event: 'verdict', data: '{"risk":"low"}' },
    ]);
  });

  it('emits a trailing message with no terminating blank line', async () => {
    const messages = [];
    for await (const message of parseSse(streamOf(['event: verdict\ndata: {}'])))
      messages.push(message);
    expect(messages).toEqual([{ event: 'verdict', data: '{}' }]);
  });
});

describe('createGuardianClient', () => {
  it('streams progress and resolves with the verdict', async () => {
    const fetchMock = respond([
      'event: progress\ndata: {"stage":"plan"}\n\n',
      'event: progress\ndata: {"stage":"analyze"}\n\n',
      'event: verdict\ndata: {"risk":"medium","summary":"ok"}\n\n',
    ]);
    const onProgress = vi.fn();
    const guardian = createGuardianClient({ url: 'http://guardian.test', fetch: fetchMock });

    const verdict = await guardian.check(request, { onProgress });

    expect(verdict.risk).toBe('medium');
    expect(onProgress.mock.calls.map(([e]) => e.stage)).toEqual(['plan', 'analyze']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://guardian.test/check');
    // bigint value must be serialised as a decimal string, not dropped by JSON
    expect(JSON.parse(init!.body as string).value).toBe('0');
  });

  it('throws on an error event', async () => {
    const guardian = createGuardianClient({
      url: 'http://guardian.test',
      fetch: respond(['event: error\ndata: {"message":"rpc down"}\n\n']),
    });
    await expect(guardian.check(request)).rejects.toThrow(/rpc down/);
  });

  it('throws when the stream ends without a verdict', async () => {
    const guardian = createGuardianClient({
      url: 'http://guardian.test',
      fetch: respond(['event: progress\ndata: {"stage":"plan"}\n\n']),
    });
    await expect(guardian.check(request)).rejects.toThrow(GuardianError);
  });

  it('surfaces a non-2xx response body', async () => {
    const guardian = createGuardianClient({
      url: 'http://guardian.test',
      fetch: vi.fn(async () => new Response('chain 999 not configured', { status: 400 })),
    });
    await expect(guardian.check(request)).rejects.toThrow(/400: chain 999 not configured/);
  });
});
