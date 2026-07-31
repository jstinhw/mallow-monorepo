import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { fetchContractInfo, _resetCache } from "./client";

const verified = {
  status: "1",
  message: "OK",
  result: [
    {
      SourceCode: "contract Hi {}",
      ABI: '[{"type":"function","name":"hi"}]',
      ContractName: "Hi",
      CompilerVersion: "v0.8.20",
      Proxy: "0",
      Implementation: "",
    },
  ],
};

const unverified = {
  status: "0",
  message: "NOTOK",
  result: [
    {
      SourceCode: "",
      ABI: "Contract source code not verified",
      ContractName: "",
      CompilerVersion: "",
      Proxy: "0",
      Implementation: "",
    },
  ],
};

const server = setupServer(
  http.get("https://api.etherscan.io/v2/api", ({ request }) => {
    const url = new URL(request.url);
    const addr = url.searchParams.get("address");
    if (addr === "0x0000000000000000000000000000000000000aaa") return HttpResponse.json(verified);
    return HttpResponse.json(unverified);
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  _resetCache();
});

describe("fetchContractInfo", () => {
  it("sends the provided Etherscan API key", async () => {
    let seenKey: string | null = null;
    server.use(
      http.get("https://api.etherscan.io/v2/api", ({ request }) => {
        seenKey = new URL(request.url).searchParams.get("apikey");
        return HttpResponse.json(verified);
      }),
    );

    await fetchContractInfo("0x0000000000000000000000000000000000000aaa", 8453, "real-key");

    expect(seenKey).toBe("real-key");
  });

  it("parses verified contract", async () => {
    const info = await fetchContractInfo("0x0000000000000000000000000000000000000aaa", 8453, "key");
    expect(info.verified).toBe(true);
    expect(info.name).toBe("Hi");
    expect(info.abi).toEqual([{ type: "function", name: "hi" }]);
    expect(info.isProxy).toBe(false);
  });

  it("flags unverified contract", async () => {
    const info = await fetchContractInfo("0x0000000000000000000000000000000000000bbb", 8453, "key");
    expect(info.verified).toBe(false);
    expect(info.name).toBeUndefined();
  });

  it("caches by chainId:address", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.etherscan.io/v2/api", () => {
        calls++;
        return HttpResponse.json(verified);
      }),
    );
    await fetchContractInfo("0x0000000000000000000000000000000000000ccc", 8453, "key");
    await fetchContractInfo("0x0000000000000000000000000000000000000ccc", 8453, "key");
    expect(calls).toBe(1);
  });
});
