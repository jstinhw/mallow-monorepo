"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CHAIN_ID } from "@/lib/constants/chains";
import type { Address } from "viem";
import type { HistoryEntry } from "@/app/api/wallet/history/route";

export function useWalletHistory(address: Address | null, limit = 10) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setEntries(null);
      setLoading(false);
      setError(null);
      return;
    }
    const alive = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/wallet/history?addr=${address}&chainId=${DEFAULT_CHAIN_ID}&limit=${limit}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `history ${res.status}`);
      if (alive) setEntries(json.entries as HistoryEntry[]);
    } catch (e) {
      if (alive) setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      if (alive) setLoading(false);
    }
  }, [address, limit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return { entries, loading, error };
}

export function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 60 * 60) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 60 * 60 * 24) return `${Math.floor(diff / (60 * 60))}h ago`;
  const days = Math.floor(diff / (60 * 60 * 24));
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
