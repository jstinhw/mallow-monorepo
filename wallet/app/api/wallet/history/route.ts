import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CHAIN_ID } from "@/lib/constants/chains";
import type { Address } from "viem";

export type HistoryEntry = {
  hash: string;
  from: Address;
  to: Address | null;
  value: string; // wei, decimal string
  timestamp: number; // unix seconds
  isError: boolean;
  direction: "in" | "out" | "self";
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const addr = (searchParams.get("addr") ?? "").toLowerCase() as Address;
  const chainId = Number(searchParams.get("chainId") ?? DEFAULT_CHAIN_ID);
  const limit = Math.min(20, Number(searchParams.get("limit") ?? 10));
  if (!addr || !addr.startsWith("0x")) {
    return NextResponse.json({ error: "addr required" }, { status: 400 });
  }
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return NextResponse.json({ error: "ETHERSCAN_API_KEY not set" }, { status: 500 });

  const url = new URL("https://api.etherscan.io/v2/api");
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", addr);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", key);

  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as { status: string; message: string; result: unknown };
    // Etherscan returns "No transactions found" with status "0" for empty wallets — treat as []
    if (json.status === "0") {
      return NextResponse.json({ entries: [] satisfies HistoryEntry[] });
    }
    if (!Array.isArray(json.result)) {
      return NextResponse.json({ error: "unexpected etherscan response" }, { status: 502 });
    }
    type Raw = {
      hash: string;
      from: string;
      to: string;
      value: string;
      timeStamp: string;
      isError: string;
    };
    const entries: HistoryEntry[] = (json.result as Raw[]).map((r) => {
      const from = r.from.toLowerCase() as Address;
      const to = (r.to || "").toLowerCase() as Address;
      const direction: HistoryEntry["direction"] =
        from === addr && to === addr ? "self" : from === addr ? "out" : to === addr ? "in" : "out";
      return {
        hash: r.hash,
        from,
        to: r.to ? to : null,
        value: r.value,
        timestamp: Number(r.timeStamp),
        isError: r.isError !== "0",
        direction,
      };
    });
    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "etherscan failed" },
      { status: 502 },
    );
  }
}
