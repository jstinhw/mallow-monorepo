import type { Address } from "viem";
import type { ContractInfo } from "../protocol";

const cache = new Map<string, ContractInfo>();
const inflight = new Map<string, Promise<ContractInfo>>();

export function _resetCache() {
  cache.clear();
  inflight.clear();
}

type RawSource = {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  Proxy: string;
  Implementation: string;
};

export async function fetchContractInfo(
  addr: Address,
  chainId: number,
  apiKey: string,
): Promise<ContractInfo> {
  const key = `${chainId}:${addr.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.searchParams.set("chainid", String(chainId));
    url.searchParams.set("module", "contract");
    url.searchParams.set("action", "getsourcecode");
    url.searchParams.set("address", addr);
    url.searchParams.set("apikey", apiKey);

    const info = await fetchWithBackoff(url, 3);
    cache.set(key, info);
    return info;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

async function fetchWithBackoff(url: URL, attempts: number): Promise<ContractInfo> {
  let delay = 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      const json = (await res.json()) as { status: string; result: RawSource[] | string };
      if (typeof json.result === "string" && /rate limit/i.test(json.result)) {
        await sleep(delay);
        delay *= 4;
        continue;
      }
      const arr = Array.isArray(json.result) ? json.result : [];
      const r = arr[0];
      if (!r) throw new Error("empty etherscan result");
      return parseSource(r, url);
    } catch (err) {
      lastErr = err;
      await sleep(delay);
      delay *= 4;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("etherscan request failed");
}

function parseSource(r: RawSource, url: URL): ContractInfo {
  const addr = url.searchParams.get("address") as Address;
  const verified = !!r.SourceCode && !/not verified/i.test(r.ABI);
  if (!verified) return { address: addr, verified: false, isProxy: r.Proxy === "1" };
  let abi: unknown[] | undefined;
  try {
    abi = JSON.parse(r.ABI) as unknown[];
  } catch {
    abi = undefined;
  }
  return {
    address: addr,
    verified: true,
    name: r.ContractName || undefined,
    abi,
    isProxy: r.Proxy === "1",
    implementation: (r.Implementation || undefined) as Address | undefined,
    sourceCode: extractPrimarySource(r.SourceCode),
  };
}

function extractPrimarySource(raw: string): string | undefined {
  if (!raw) return undefined;
  // Multi-file Solidity: wrapped in {{ ... }}
  if (raw.startsWith("{{")) {
    try {
      const parsed = JSON.parse(raw.slice(1, -1)) as {
        sources?: Record<string, { content?: string }>;
      };
      const files = Object.values(parsed.sources ?? {});
      // Return all file contents joined; trim to 50000 chars total
      return files
        .map((f) => f.content ?? "")
        .join("\n\n")
        .slice(0, 50000);
    } catch {
      return raw.slice(1, -1).slice(0, 50000);
    }
  }
  // Single-file JSON or plain Solidity
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { sources?: Record<string, { content?: string }> };
      const files = Object.values(parsed.sources ?? {});
      return files
        .map((f) => f.content ?? "")
        .join("\n\n")
        .slice(0, 50000);
    } catch {
      // fall through
    }
  }
  return raw.slice(0, 50000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
