import { isAddress, toFunctionSelector, type Address, type Hex } from "viem";
import type { ContractInfo } from "../../protocol";
import { getCode } from "../../cast";
import { CHAINS } from "../../config";
import { fetchContractInfo } from "../../etherscan/client";
import { makeFinding } from "../risk";
import type { GuardianTool, OpenAIToolSchema, ToolContext, ToolExecuteResult } from "./types";
import { truncate } from "./text";

type GetContractArgs = { address?: Address };

type GetContractResult =
  | {
      kind: "eoa";
      address: Address;
      sentNormalTx: true;
      sentNormalTxChainId: number;
      sentNormalTxHash?: string;
      delegationCode?: Hex;
      checkedChainIds: number[];
      sampledNormalTxCount: number;
      sampledInternalTxCount: number;
    }
  | {
      kind: "empty-or-undeployed";
      address: Address;
      sentNormalTx: false;
      checkedChainIds: number[];
      sampledNormalTxCount: number;
      sampledInternalTxCount: number;
    }
  | {
      kind: "contract";
      address: Address;
      verified: boolean;
      name?: string;
      isProxy: boolean;
      implementation?: Address;
      abiSelectors?: string[];
      sourceSnippet?: string;
    };

const ETHERSCAN_API = "https://api.etherscan.io/v2/api";

const schema: OpenAIToolSchema = {
  type: "function",
  function: {
    name: "get_contract_info",
    description:
      "Look up an address: bytecode (EOA vs contract), Etherscan verification, contract name, proxy flag and implementation, and ABI selectors. Answers: is this address an EOA or contract, is it verified, and what is it? Defaults to the tx's `to`; pass `address` to probe addresses found inside a trace.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        address: {
          type: "string",
          description: "Optional address to look up. Omit to inspect the tx's `to` field.",
          pattern: "^0x[0-9a-fA-F]{40}$",
        },
      },
    },
  },
};

function parseArgs(raw: unknown): GetContractArgs | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.address === undefined) return {};
  if (typeof obj.address !== "string" || !isAddress(obj.address, { strict: false })) return null;
  return { address: obj.address };
}

function abiSelectors(abi: unknown[] | undefined): string[] | undefined {
  if (!abi) return undefined;
  const out: string[] = [];
  for (const item of abi) {
    if (!item || typeof item !== "object") continue;
    const i = item as { type?: string; name?: string; inputs?: { type: string }[] };
    if (i.type !== "function" || !i.name) continue;
    const sig = `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(",")})`;
    out.push(sig);
  }
  return out;
}

async function execute(
  args: GetContractArgs,
  ctx: ToolContext,
): Promise<ToolExecuteResult<GetContractResult>> {
  const addr = (args.address ?? ctx.input.to) as Address;
  const isTopLevel = addr.toLowerCase() === ctx.input.to.toLowerCase();
  const cacheKey = addr.toLowerCase() as Address;

  if (ctx.contractCache.has(cacheKey)) {
    const info = ctx.contractCache.get(cacheKey)!;
    if (isTopLevel) ctx.lastContract = info;
    const calledFn = isTopLevel
      ? resolveCalledFunction(ctx.input.data as Hex, info?.abi)
      : undefined;
    return { ok: true, result: toResult(addr, info, calledFn) };
  }

  let code: unknown;
  try {
    code = await getCode(addr, ctx.cfg.rpcUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: `getCode failed: ${msg}` };
  }

  const normalizedCode = normalizeCode(code);
  const delegationCode =
    normalizedCode && isEip7702DelegationCode(normalizedCode) ? normalizedCode : undefined;
  if (isNoRuntimeCode(normalizedCode) || delegationCode) {
    const evidence = await fetchNoCodeAddressEvidence(
      addr,
      ctx.input.chainId,
      ctx.cfg.etherscanKey,
    );
    const result: GetContractResult = evidence.sentNormalTx
      ? {
          kind: "eoa",
          address: addr,
          sentNormalTx: true,
          sentNormalTxChainId: evidence.sentNormalTxChainId,
          sentNormalTxHash: evidence.sentNormalTxHash,
          delegationCode,
          checkedChainIds: evidence.checkedChainIds,
          sampledNormalTxCount: evidence.sampledNormalTxCount,
          sampledInternalTxCount: evidence.sampledInternalTxCount,
        }
      : {
          kind: "empty-or-undeployed",
          address: addr,
          sentNormalTx: false,
          checkedChainIds: evidence.checkedChainIds,
          sampledNormalTxCount: evidence.sampledNormalTxCount,
          sampledInternalTxCount: evidence.sampledInternalTxCount,
        };
    if (isTopLevel) {
      ctx.lastContract = null;
      if (result.kind === "eoa") {
        ctx.findings.push(
          makeFinding({
            id: "eoa-recipient",
            severity: "info",
            title: "Target is an EOA",
            detail: result.delegationCode
              ? `The address has EIP-7702 delegation code and has sent a normal transaction on chain ${result.sentNormalTxChainId}.`
              : `No contract code at the destination, and the address has sent a normal transaction on chain ${result.sentNormalTxChainId}.`,
          }),
        );
      } else {
        ctx.findings.push(
          makeFinding({
            id: "empty-or-undeployed-recipient",
            severity: "medium",
            title: "Recipient has no code and no EOA proof",
            detail: delegationCode
              ? "The address has EIP-7702 delegation code, but Etherscan history did not show a normal transaction signed by this address."
              : "No contract code is deployed at the destination, but Etherscan history did not show a normal transaction signed by this address. It may be a fresh wallet or an undeployed contract address.",
          }),
        );
      }
    }
    return { ok: true, result };
  }

  let info: ContractInfo;
  try {
    info = await fetchContractInfo(addr, ctx.input.chainId, ctx.cfg.etherscanKey);
  } catch {
    info = { address: addr, verified: false, isProxy: false };
    if (isTopLevel) {
      ctx.findings.push(
        makeFinding({
          id: "etherscan-unavailable",
          severity: "medium",
          title: "Could not check verification status",
          detail: "Etherscan call failed; treating contract as unverified.",
        }),
      );
    }
  }

  if (isTopLevel && !info.verified) {
    ctx.findings.push(
      makeFinding({
        id: "unverified-target",
        severity: "medium",
        title: "Unverified contract",
        detail: "Etherscan has no source for this contract on this chain.",
      }),
    );
  }

  ctx.contractCache.set(cacheKey, info);
  if (isTopLevel) ctx.lastContract = info;
  const calledFn = isTopLevel ? resolveCalledFunction(ctx.input.data as Hex, info.abi) : undefined;

  // Source-code-based deterministic findings — no LLM inference required.
  if (isTopLevel && info.verified && info.sourceCode) {
    const sourceFindings = analyzeSourceForFindings(
      info.sourceCode,
      calledFn,
      ctx.input.data as Hex,
    );
    for (const f of sourceFindings) ctx.findings.push(f);
  }

  // ERC-20 transfer to AMM pair: when the called function is transfer(address,uint256),
  // auto-probe the decoded recipient to check if it's an AMM pair. The LLM often misses
  // this because it focuses on the transaction's `to` (the token contract) rather than
  // the inner calldata argument (the actual recipient).
  if (isTopLevel && calledFn === "transfer") {
    await checkTransferRecipientForAmmPair(ctx, ctx.input.data as Hex);
  }

  return { ok: true, result: toResult(addr, info, calledFn) };
}

async function checkTransferRecipientForAmmPair(ctx: ToolContext, data: Hex): Promise<void> {
  // transfer(address,uint256): selector 0xa9059cbb, first arg = recipient (bytes 10–73)
  if (!data || data.length < 74) return;
  const recipientHex = "0x" + data.slice(10 + 24, 10 + 64); // strip leading zeros from padded address
  if (!isAddress(recipientHex, { strict: false })) return;
  const recipient = recipientHex as Address;
  const cacheKey = recipient.toLowerCase() as Address;

  let recipientInfo: ContractInfo | null | undefined = ctx.contractCache.get(cacheKey);
  if (!recipientInfo) {
    try {
      recipientInfo = await fetchContractInfo(recipient, ctx.input.chainId, ctx.cfg.etherscanKey);
      ctx.contractCache.set(cacheKey, recipientInfo);
    } catch {
      return;
    }
  }

  if (!recipientInfo?.abi) return;
  const sigs = abiSelectors(recipientInfo.abi) ?? [];
  const isAmmPair =
    sigs.some((s) => s.startsWith("reserve0(")) ||
    sigs.some((s) => s.startsWith("reserve1(")) ||
    sigs.some((s) => s.startsWith("getReserves(")) ||
    (recipientInfo.name ?? "").toLowerCase().includes("pair");

  if (isAmmPair) {
    ctx.findings.push(
      makeFinding({
        id: "erc20-transfer-to-amm-pair",
        severity: "medium",
        title: "Direct ERC-20 transfer to AMM pair",
        detail: `Tokens sent directly to ${recipientInfo.name ?? recipient} (an AMM pair) bypass the router and inflate the pair's real balance without updating stored reserves — a price-manipulation setup step.`,
      }),
    );
  }
}

function analyzeSourceForFindings(
  source: string,
  calledFn: string | undefined,
  _data: Hex,
): ReturnType<typeof makeFinding>[] {
  const findings: ReturnType<typeof makeFinding>[] = [];

  // Pattern: permissionless function that burns an AMM pair's token reserves.
  // Signals:
  //   (a) the function body has NO access control keyword
  //   (b) the function (or a helper it calls) burns tokens via _burn / Transfer(address(0))
  //   (c) the contract references an AMM pair (uniswapV2Pair / pool / IUniswapV2Pair)
  if (calledFn) {
    const fnSnippet = extractFunctionSnippet(source, calledFn) ?? "";
    const noAccessControl =
      !/\bonlyOwner\b/.test(fnSnippet) &&
      !/require\s*\(\s*msg\.sender\s*==/.test(fnSnippet) &&
      !/onlyRole\b/.test(fnSnippet) &&
      !/AccessControl/.test(fnSnippet);
    const burnSignal =
      /_burn\s*\(/.test(fnSnippet) ||
      /Transfer\s*\([^,]+,\s*address\s*\(\s*0\s*\)/.test(fnSnippet) ||
      /autoBurn|burnToken|burnFrom|burnReserve/.test(fnSnippet);
    const pairSignal = /uniswapV2Pair|UniswapV2Pair|IUniswapV2Pair|pancakeV2Pair|pancakePair/.test(
      source,
    );

    // Broaden: look into helper functions the called fn delegates to
    const delegateMatch = fnSnippet.match(/_(\w+)\s*\(/g);
    let delegateBurn = false;
    if (delegateMatch) {
      for (const m of delegateMatch) {
        const helperName = m.slice(1).replace(/\s*\($/, "");
        const helperSnippet = extractFunctionSnippet(source, helperName) ?? "";
        if (
          /_burn\s*\(/.test(helperSnippet) ||
          /Transfer\s*\([^,]+,\s*address\s*\(\s*0\s*\)/.test(helperSnippet)
        ) {
          delegateBurn = true;
        }
      }
    }

    if (noAccessControl && (burnSignal || delegateBurn) && pairSignal) {
      findings.push(
        makeFinding({
          id: "permissionless-reserve-burn",
          severity: "high",
          title: "Permissionless function drains AMM pair reserves",
          detail: `\`${calledFn}\` has no access control and burns tokens from an AMM pair — anyone can call this to destroy liquidity.`,
        }),
      );
    }

    // Pattern: AMM reserve synchronization.
    // The called contract IS an AMM pair — it declares reserve0/reserve1 as storage
    // state variables (uint112 private/public reserve0) and the called function updates them.
    // We distinguish state vars from local vars by requiring type+visibility pattern.
    const isPair =
      /uint\d+\s+(?:private|public|internal)?\s*reserve0\b/.test(source) &&
      /uint\d+\s+(?:private|public|internal)?\s*reserve1\b/.test(source);
    const syncsFn =
      /_update\s*\(/.test(fnSnippet) ||
      /reserve0\s*=\s*(?!.*getReserves)/.test(fnSnippet) ||
      /reserve1\s*=\s*(?!.*getReserves)/.test(fnSnippet);

    if (isPair && syncsFn) {
      findings.push(
        makeFinding({
          id: "amm-reserve-sync",
          severity: "medium",
          title: "AMM reserve synchronization",
          detail: `\`${calledFn}\` resets the pair's internal reserves to match actual token balances. After a direct token donation, this permanently locks in a manipulated price.`,
        }),
      );
    }
  }

  // Pattern: ERC-20 transfer directly to an AMM pair address.
  // Check if the tx's `to` is this contract AND the calldata is transfer(address,uint256),
  // AND the decoded `to` argument is an AMM pair. We can't verify the recipient here without
  // another RPC call, so this is handled in simulation.ts via Transfer event analysis.

  return findings;
}

function resolveCalledFunction(data: Hex, abi: unknown[] | undefined): string | undefined {
  if (!data || data.length < 10 || !abi) return undefined;
  const selector = data.slice(0, 10).toLowerCase();
  for (const item of abi) {
    if (!item || typeof item !== "object") continue;
    const i = item as { type?: string; name?: string; inputs?: { type: string }[] };
    if (i.type !== "function" || !i.name) continue;
    const sig = `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(",")})`;
    try {
      if (toFunctionSelector(sig).toLowerCase() === selector) return i.name;
    } catch {
      // ignore malformed sig
    }
  }
  return undefined;
}

function toResult(
  addr: Address,
  info: ContractInfo | null,
  calledFunctionName?: string,
): GetContractResult {
  if (!info) {
    return {
      kind: "empty-or-undeployed",
      address: addr,
      sentNormalTx: false,
      checkedChainIds: [],
      sampledNormalTxCount: 0,
      sampledInternalTxCount: 0,
    };
  }
  return {
    kind: "contract",
    address: addr,
    verified: info.verified,
    name: info.name,
    isProxy: info.isProxy,
    implementation: info.implementation,
    abiSelectors: abiSelectors(info.abi),
    sourceSnippet: extractFunctionSnippet(info.sourceCode, calledFunctionName),
  };
}

function extractFunctionSnippet(
  source: string | undefined,
  functionName?: string,
): string | undefined {
  if (!source) return undefined;
  if (functionName) {
    const patterns = [`function ${functionName}(`, `function ${functionName} (`];
    // Collect all occurrences; prefer the one with a function body (contains "{")
    const candidates: Array<{ idx: number; hasBody: boolean }> = [];
    for (const pattern of patterns) {
      let searchFrom = 0;
      while (searchFrom < source.length) {
        const idx = source.indexOf(pattern, searchFrom);
        if (idx === -1) break;
        // Look ahead up to 200 chars for "{" vs ";" (interface vs implementation)
        const lookahead = source.slice(idx, idx + 200);
        const bracePos = lookahead.indexOf("{");
        const semicolonPos = lookahead.indexOf(";");
        const hasBody = bracePos !== -1 && (semicolonPos === -1 || bracePos < semicolonPos);
        candidates.push({ idx, hasBody });
        searchFrom = idx + 1;
      }
    }
    // Prefer an entry with a body; fall back to first occurrence
    const best = candidates.find((c) => c.hasBody) ?? candidates[0];
    if (best) {
      const start = Math.max(0, best.idx - 100);
      const end = Math.min(source.length, best.idx + 1200);
      return source.slice(start, end);
    }
  }
  return source.slice(0, 2000);
}

function normalizeCode(code: unknown): Hex | undefined {
  if (typeof code !== "string") return undefined;
  const trimmed = code.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase() as Hex;
}

function isNoRuntimeCode(code: Hex | undefined): boolean {
  return code === undefined || /^0x0*$/.test(code);
}

function isEip7702DelegationCode(code: Hex): code is Hex {
  return /^0xef0100[0-9a-fA-F]{40}$/.test(code);
}

type RawNormalTx = { hash?: string; from?: string };
type RawInternalTx = { hash?: string; from?: string; type?: string; contractAddress?: string };

type NoCodeAddressEvidence =
  | {
      sentNormalTx: false;
      checkedChainIds: number[];
      sampledNormalTxCount: number;
      sampledInternalTxCount: number;
    }
  | {
      sentNormalTx: true;
      sentNormalTxChainId: number;
      sentNormalTxHash?: string;
      checkedChainIds: number[];
      sampledNormalTxCount: number;
      sampledInternalTxCount: number;
    };

async function fetchNoCodeAddressEvidence(
  addr: Address,
  primaryChainId: number,
  apiKey: string,
): Promise<NoCodeAddressEvidence> {
  const chainIds = historyChainIds(primaryChainId);
  const checkedChainIds: number[] = [];
  let sampledNormalTxCount = 0;
  let sampledInternalTxCount = 0;

  for (const chainId of chainIds) {
    checkedChainIds.push(chainId);
    const normal = await fetchAccountTxs<RawNormalTx>(addr, chainId, apiKey, "txlist");
    sampledNormalTxCount += normal.length;
    const sent = normal.find((tx) => tx.from?.toLowerCase() === addr.toLowerCase());
    if (sent) {
      return {
        sentNormalTx: true,
        sentNormalTxChainId: chainId,
        sentNormalTxHash: sent.hash,
        checkedChainIds,
        sampledNormalTxCount,
        sampledInternalTxCount,
      };
    }
  }

  for (const chainId of chainIds) {
    const internal = await fetchAccountTxs<RawInternalTx>(addr, chainId, apiKey, "txlistinternal");
    sampledInternalTxCount += internal.length;
  }

  return {
    sentNormalTx: false,
    checkedChainIds,
    sampledNormalTxCount,
    sampledInternalTxCount,
  };
}

function historyChainIds(primaryChainId: number): number[] {
  return [
    primaryChainId,
    ...CHAINS.map((chain) => chain.chainId).filter((chainId) => chainId !== primaryChainId),
  ];
}

async function fetchAccountTxs<T>(
  addr: Address,
  chainId: number,
  apiKey: string,
  action: "txlist" | "txlistinternal",
): Promise<T[]> {
  const url = new URL(ETHERSCAN_API);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", addr);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "999999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "10");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url);
    const json = (await res.json()) as { status: string; message?: string; result: unknown };
    if (json.status === "0" && /no transactions/i.test(String(json.message ?? ""))) return [];
    if (!Array.isArray(json.result)) return [];
    return json.result as T[];
  } catch {
    return [];
  }
}

function summarizeResult(
  _args: GetContractArgs | null,
  result: GetContractResult | { error: string },
  ok: boolean,
): string {
  if (!ok || "error" in result) {
    const msg = "error" in result ? result.error : "lookup failed";
    return truncate(`Failed: ${msg}`);
  }
  if (result.kind === "eoa") {
    return result.delegationCode
      ? `EOA — EIP-7702 delegation, sent tx on chain ${result.sentNormalTxChainId}`
      : `EOA — sent tx on chain ${result.sentNormalTxChainId}`;
  }
  if (result.kind === "empty-or-undeployed") return "No code — EOA not proven";
  if (result.verified) {
    return result.name ? truncate(`${result.name} · verified`) : "Verified contract";
  }
  return "Unverified contract";
}

export const getContractInfoTool: GuardianTool<GetContractArgs, GetContractResult> = {
  name: schema.function.name,
  openaiToolSchema: schema,
  plannerHint:
    "get_contract_info — answers: is the address an EOA or contract, is the contract verified, and what is its name? Use when: any tx (always at minimum to classify the recipient). Cost: fast.",
  interpretationGuide: `## Skill: interpret get_contract_info

kind: 'eoa' — either no bytecode on this chain, or EIP-7702 delegation bytecode, and Etherscan normal transaction history shows this address has signed a top-level transaction on at least one supported chain. ETH transfers to an EOA are normal. EIP-7702 delegation code is EOA authorization state, not a verified contract source signal for the address itself.
kind: 'empty-or-undeployed' — no bytecode on this chain, but no outgoing normal transaction was found for the address. It may be a fresh EOA, a precomputed undeployed contract address, or a mistaken address. Do not call it verified or safe solely because code is 0x.
kind: 'contract':
  verified=true + name set → strongest trust signal short of running the code. Cross-reference the name against the user's stated intent.
  verified=false → cannot audit; raise risk one level. verified=false alone is NOT critical — it's a warning, not a verdict.
  isProxy=true → the real logic lives at \`implementation\`. Consider probing it.
  abiSelectors[] → the function signatures this contract exposes. Check for AMM patterns: reserve0(), reserve1(), getReserves(), Sync event = AMM pair. A uniswapV2Pair() getter on a token contract = pair-integrated token (check for burn functions).
  sourceSnippet → verified Solidity source of the called function (and context). READ THIS CAREFULLY for: (1) access control — onlyOwner/require(msg.sender==owner)/role checks absent = permissionless; (2) burn operations — _burn(pair, amount) or Transfer(pair, address(0), amount) = destroys pair liquidity; (3) reserve mutations — _update(balanceOf...) or reserve0=balance = reserve sync.`,
  friendlyLabel: "Looked up contract",
  summarizeResult,
  parseArgs,
  execute,
};
