import type { Hex } from "viem";

// Selector → human-readable signature lookup, as a fallback to cast's local
// 4byte database. Sourcify itself only verifies contract source; the actual
// signature database used across the Foundry/security ecosystem is openchain.xyz
// (the successor to sig.eth.samczsun.com). We keep the module name "sourcify"
// per project convention while hitting the openchain endpoint that holds the data.
const ENDPOINT = "https://api.openchain.xyz/signature-database/v1/lookup";

const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;

const cache = new Map<Hex, string[]>();
const inflight = new Map<Hex, Promise<string[]>>();

export function _resetCache(): void {
  cache.clear();
  inflight.clear();
}

export async function lookupSignature(selector: Hex): Promise<string[]> {
  if (!SELECTOR_RE.test(selector)) return [];
  const cached = cache.get(selector);
  if (cached) return cached;
  const pending = inflight.get(selector);
  if (pending) return pending;

  const promise = (async (): Promise<string[]> => {
    try {
      const url = `${ENDPOINT}?function=${selector}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        ok?: boolean;
        result?: { function?: Record<string, { name: string; filtered?: boolean }[]> };
      };
      const entries = json.result?.function?.[selector] ?? [];
      return entries.filter((e) => !e.filtered).map((e) => e.name);
    } catch {
      return [];
    }
  })().finally(() => inflight.delete(selector));

  inflight.set(selector, promise);
  promise.then((sigs) => cache.set(selector, sigs)).catch(() => undefined);
  return promise;
}
