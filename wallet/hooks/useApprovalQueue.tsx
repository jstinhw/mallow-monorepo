"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CHAIN_ID } from "@/lib/constants/chains";
import {
  type LiveStatus,
  type LiveAction,
  type QueueItem,
  type SignatureReview,
} from "@/types/queue";
import type { AgentRequest } from "@mallow/agents-protocol";
import { safeHost } from "@/lib/walletconnect/requests";
import type { UnlockedWallet } from "@/lib/wallet/wallet";
import type { GuardianVerdict } from "@/types/guardian";
import type { Address, Hex } from "viem";

type SubmitArgs = {
  from: Address;
  to: Address;
  value: bigint;
  data?: Hex;
  chainId?: number;
  intent?: string;
};

export type RequestBridge = { onSigned: (result: Hex) => void; onRejected: () => void };

type SubmitSignatureArgs = SignatureReview;

const guardianCheckUrl = () =>
  new URL(
    "/check",
    process.env.NEXT_PUBLIC_GUARDIAN_AGENT_URL ?? "http://localhost:3003",
  ).toString();

const guardianServiceError = async (res: Response) => {
  let detail = "";
  try {
    detail = (await res.text()).trim();
  } catch {
    detail = "";
  }

  if (detail) {
    try {
      const parsed = JSON.parse(detail) as unknown;
      if (parsed && typeof parsed === "object") {
        const fields = parsed as { error?: unknown; message?: unknown };
        const message = fields.error ?? fields.message;
        if (typeof message === "string" && message.trim()) detail = message.trim();
      }
    } catch {
      // Keep the raw response text when it is not JSON.
    }
  }

  return `guardian service ${res.status}: ${detail || res.statusText || "request failed"}`;
};

type Api = {
  queue: QueueItem[];
  pending: QueueItem[];
  toasts: QueueItem[];
  dismissToast: (id: string) => void;
  approve: (id: string) => void;
  reject: (id: string) => void;
  push: (item: QueueItem) => void;
  byId: (id: string) => QueueItem | undefined;
  submitLive: (args: SubmitArgs, bridge?: RequestBridge) => string;
  submitAgentInstallReview: (args: {
    pluginId: string;
    serviceUrl: string;
    mallowMainWallet: Address;
    agentKey: string;
    request: AgentRequest;
  }) => string;
  signLive: (id: string, wallet: UnlockedWallet) => Promise<string>;
  submitSignatureRequest: (args: SubmitSignatureArgs, bridge?: RequestBridge) => string;
  signSignatureRequest: (id: string, wallet: UnlockedWallet) => Promise<Hex>;
};

const Ctx = createContext<Api | null>(null);

export function ApprovalQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [toasts, setToasts] = useState<QueueItem[]>([]);
  const counter = useRef(0);
  const bridges = useRef(new Map<string, RequestBridge>());
  // Always-current snapshot of the queue for async closures.
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const dismissToast = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const approve = useCallback(
    (id: string) => {
      setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: "approved" } : x)));
      dismissToast(id);
    },
    [dismissToast],
  );

  const reject = useCallback(
    (id: string) => {
      setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: "rejected" } : x)));
      bridges.current.get(id)?.onRejected();
      bridges.current.delete(id);
      dismissToast(id);
    },
    [dismissToast],
  );

  const push = useCallback((item: QueueItem) => {
    setQueue((q) => [item, ...q]);
    setToasts((ts) => [...ts, item]);
    setTimeout(() => {
      setToasts((ts) => ts.filter((x) => x.id !== item.id));
    }, 6000);
  }, []);

  async function runGuardian(item: QueueItem) {
    if (!item.live) return;
    const checkUrl = guardianCheckUrl();
    try {
      let typedData: unknown = undefined;
      if (item.signatureReview?.method === "eth_signTypedData_v4") {
        const params = item.signatureReview.raw as unknown[];
        try {
          typedData =
            typeof params[1] === "string"
              ? JSON.parse(params[1])
              : item.signatureReview.view.kind === "typedData"
                ? item.signatureReview.view.typedData
                : null;
        } catch (e) {
          console.error("Failed to parse typed data for runGuardian:", e);
        }
      }

      const res = await fetch(checkUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: item.live.chainId ?? DEFAULT_CHAIN_ID,
          from: item.live.tx.from,
          to: item.live.tx.to,
          value: item.live.tx.value,
          data: item.live.tx.data,
          ...(typedData ? { typedData } : {}),
        }),
      });
      if (!res.ok) throw new Error(await guardianServiceError(res));
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        throw new Error(`guardian service returned ${contentType || "an unexpected response"}`);
      }
      if (!res.body) {
        throw new Error("guardian service returned no stream");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const lines = ev.split("\n");
          const evtLine = lines
            .find((l) => l.startsWith("event: "))
            ?.slice(7)
            .trim();
          const dataLine = lines
            .find((l) => l.startsWith("data: "))
            ?.slice(6)
            .trim();
          if (!evtLine || !dataLine) continue;
          if (evtLine === "progress") {
            const payload = JSON.parse(dataLine) as {
              stage: string;
              phase?: "tool_start" | "tool_complete";
              callId?: string;
              round?: number;
              label?: string;
              ok?: boolean;
              durationMs?: number;
              summary?: string;
              actions?: string[];
              reasoning?: string;
              intent?: string;
              field?: "summary" | "reasoning";
              text?: string;
            };
            if (payload.stage === "plan_ready") {
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  return {
                    ...x,
                    live: {
                      ...x.live,
                      planActions: payload.actions as LiveStatus["planActions"],
                      planReasoning: payload.reasoning,
                    },
                  };
                }),
              );
              continue;
            }
            if (payload.stage === "analyze_thinking") {
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  const round = payload.round ?? 0;
                  const intent = payload.intent ?? "";
                  return {
                    ...x,
                    live: {
                      ...x.live,
                      roundIntents: { ...(x.live.roundIntents ?? {}), [round]: intent },
                    },
                  };
                }),
              );
              continue;
            }
            if (payload.stage === "llm_delta") {
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  return {
                    ...x,
                    live: {
                      ...x.live,
                      ...(payload.field === "summary" ? { draftSummary: payload.text ?? "" } : {}),
                      ...(payload.field === "reasoning"
                        ? { draftReasoning: payload.text ?? "" }
                        : {}),
                    },
                  };
                }),
              );
              continue;
            }
            if (payload.phase === "tool_start") {
              const action: LiveAction = {
                callId: payload.callId!,
                round: payload.round!,
                label: payload.label!,
                status: "running",
              };
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  return { ...x, live: { ...x.live, actions: [...x.live.actions, action] } };
                }),
              );
            } else if (payload.phase === "tool_complete") {
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  const actions = x.live.actions.map((a) =>
                    a.callId === payload.callId
                      ? {
                          ...a,
                          status: payload.ok ? ("ok" as const) : ("error" as const),
                          durationMs: payload.durationMs,
                          summary: payload.summary,
                        }
                      : a,
                  );
                  return { ...x, live: { ...x.live, actions } };
                }),
              );
            } else {
              setQueue((q) =>
                q.map((x) => {
                  if (x.id !== item.id || !x.live) return x;
                  return { ...x, live: { ...x.live, stage: payload.stage as LiveStatus["stage"] } };
                }),
              );
            }
          } else if (evtLine === "verdict") {
            const verdict = JSON.parse(dataLine) as GuardianVerdict;
            setQueue((q) =>
              q.map((x) => {
                if (x.id !== item.id || !x.live) return x;
                return { ...x, ...applyVerdict(x, verdict) };
              }),
            );
          } else if (evtLine === "error") {
            const err = (JSON.parse(dataLine) as { message: string }).message;
            setQueue((q) =>
              q.map((x) => {
                if (x.id !== item.id || !x.live) return x;
                return { ...x, live: { ...x.live, stage: "error", error: err } };
              }),
            );
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? `guardian service unreachable at ${checkUrl}`
          : err instanceof Error
            ? err.message
            : "guardian fetch failed";
      const current = queueRef.current.find((q) => q.id === item.id);
      if (current?.live)
        updateItem(item.id, { live: { ...current.live, stage: "error", error: msg } });
    }
  }

  const submitLive = useCallback(
    (args: SubmitArgs, bridge?: RequestBridge): string => {
      const id = `live-${Date.now().toString(36)}-${counter.current++}`;
      const chainId = args.chainId ?? DEFAULT_CHAIN_ID;
      const data = args.data ?? "0x";
      const eth = Number(args.value) / 1e18;
      const isErc20 = args.data && args.data !== "0x" && args.value === 0n;
      const intentLabel =
        args.intent ?? `Send ${eth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;

      const placeholder: QueueItem = {
        id,
        agent: "self",
        proposedAt: "just now",
        proposedAtMs: Date.now(),
        intent: intentLabel,
        why: "Guardian is reviewing this transaction…",
        risk: "info",
        assetDiff: isErc20
          ? [] // guardian verdict will fill in the real asset diff for ERC-20
          : [{ sym: "ETH", delta: -eth, fiat: null }],
        counterparty: {
          name: `${args.to.slice(0, 6)}…${args.to.slice(-4)}`,
          verified: false,
          age: "—",
          contracts: 0,
        },
        impacts: [],
        findings: [],
        sim: { gas: "—", reverts: false },
        requiresTyping: false,
        live: {
          tx: { from: args.from, to: args.to, value: args.value.toString(), data },
          stage: "plan",
          chainId,
          actions: [],
        },
      };
      if (bridge) bridges.current.set(id, bridge);
      setQueue((q) => [placeholder, ...q]);
      void runGuardian(placeholder);
      return id;
    },
    [runGuardian],
  );

  const submitAgentInstallReview = useCallback(
    (args: {
      pluginId: string;
      serviceUrl: string;
      mallowMainWallet: Address;
      agentKey: string;
      request: AgentRequest;
    }): string => {
      const id = `agent-install-${Date.now().toString(36)}-${counter.current++}`;
      const placeholder: QueueItem = {
        id,
        agent: args.agentKey,
        proposedAt: "just now",
        proposedAtMs: Date.now(),
        intent: `Install ${args.request.name}`,
        why: args.request.description,
        risk: "info",
        assetDiff: [],
        counterparty: {
          name: new URL(args.serviceUrl).host,
          verified: true,
          age: "agent service",
          contracts: args.request.actions.length,
        },
        impacts: args.request.actions.map((action) =>
          action.kind === "tx"
            ? `Send tx to ${action.to} on chain ${action.chainId}.`
            : `Sign ${action.payload.type === "typedData" ? "typed data" : "a message"} on chain ${action.chainId}.`,
        ),
        findings: [],
        sim: { gas: "—", reverts: false },
        requiresTyping: false,
        agentInstall: {
          kind: "agent-install",
          pluginId: args.pluginId,
          serviceUrl: args.serviceUrl,
          mallowMainWallet: args.mallowMainWallet,
          request: args.request,
          stage: "ready",
        },
      };
      setQueue((q) => [placeholder, ...q]);
      setToasts((ts) => [...ts, placeholder]);
      setTimeout(() => {
        setToasts((ts) => ts.filter((x) => x.id !== id));
      }, 6000);
      return id;
    },
    [],
  );

  const signLive = useCallback(
    async (id: string, wallet: UnlockedWallet): Promise<string> => {
      const item = queueRef.current.find((q) => q.id === id);
      if (!item?.live) throw new Error("not a live item");
      if (item.live.stage !== "ready") throw new Error("guardian not finished yet");

      const chainId = item.live.chainId ?? DEFAULT_CHAIN_ID;
      const { sendWalletTransaction } = await import("@/lib/wallet/wallet");
      const hash = await sendWalletTransaction(wallet, {
        chainId,
        to: item.live.tx.to,
        value: BigInt(item.live.tx.value),
        data: item.live.tx.data,
      });
      updateItem(id, { state: "approved", live: { ...item.live, txHash: hash } });
      bridges.current.get(id)?.onSigned(hash);
      bridges.current.delete(id);
      return hash;
    },
    [updateItem],
  );

  const submitSignatureRequest = useCallback(
    (args: SubmitSignatureArgs, bridge?: RequestBridge): string => {
      const id = `sig-${Date.now().toString(36)}-${counter.current++}`;
      const intent =
        args.view.kind === "typedData"
          ? `Sign typed data for ${args.origin.name}`
          : `Sign a message for ${args.origin.name}`;

      let live: QueueItem["live"] = undefined;
      if (args.method === "eth_signTypedData_v4") {
        const params = args.raw as unknown[];
        let verifyingContract: Address | undefined = undefined;
        // We only read the domain's verifyingContract/chainId here; keep the
        // shape minimal rather than the full EIP-712 type.
        type ParsedTypedData = {
          domain?: { verifyingContract?: string; chainId?: string | number };
        };
        let typedDataObj: ParsedTypedData | null = null;
        try {
          typedDataObj =
            typeof params[1] === "string"
              ? (JSON.parse(params[1]) as ParsedTypedData)
              : args.view.kind === "typedData"
                ? (args.view.typedData as unknown as ParsedTypedData)
                : null;
          if (typedDataObj?.domain?.verifyingContract) {
            verifyingContract = typedDataObj.domain.verifyingContract as Address;
          }
        } catch (e) {
          console.error("Failed to parse typed data in submitSignatureRequest:", e);
        }

        if (verifyingContract) {
          const chainId =
            typedDataObj?.domain?.chainId != null
              ? Number(typedDataObj.domain.chainId)
              : (args.chainId ?? DEFAULT_CHAIN_ID);
          live = {
            tx: {
              from: args.account,
              to: verifyingContract,
              value: "0",
              data: "0x",
            },
            stage: "plan",
            chainId,
            actions: [],
          };
        }
      }

      const placeholder: QueueItem = {
        id,
        agent: "self",
        proposedAt: "just now",
        proposedAtMs: Date.now(),
        intent,
        why: `${args.origin.name} is asking you to sign with your wallet. No funds move when you sign.`,
        risk: "info",
        assetDiff: [],
        counterparty: {
          name: args.origin.name,
          verified: false,
          age: safeHost(args.origin.url),
          contracts: 0,
        },
        impacts: [],
        findings: [],
        sim: { gas: "—", reverts: false },
        requiresTyping: false,
        signatureReview: args,
        live,
      };
      if (bridge) bridges.current.set(id, bridge);
      setQueue((q) => [placeholder, ...q]);
      setToasts((ts) => [...ts, placeholder]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
      if (live) {
        void runGuardian(placeholder);
      }
      return id;
    },
    [runGuardian],
  );

  const signSignatureRequest = useCallback(
    async (id: string, wallet: UnlockedWallet): Promise<Hex> => {
      const item = queueRef.current.find((q) => q.id === id);
      const sig = item?.signatureReview;
      if (!sig) throw new Error("not a signature item");
      const params = sig.raw as unknown[];
      let signature: Hex;
      if (sig.method === "eth_signTypedData" || sig.method === "eth_signTypedData_v4") {
        const td = (typeof params[1] === "string" ? JSON.parse(params[1] as string) : sig.view) as {
          domain: Record<string, unknown>;
          types: Record<string, unknown>;
          primaryType: string;
          message: Record<string, unknown>;
        };
        const { EIP712Domain: _omit, ...types } = td.types as Record<string, unknown>;
        void _omit;
        // dApps send EIP-712 over JSON, where every integer is a string. viem
        // coerces string uints in `message`, but `getTypesForEIP712Domain` only
        // keeps `chainId` when `typeof chainId === "number"` — a string is
        // silently dropped from the domain separator, yielding a valid-looking
        // signature over the wrong domain that Permit2/the dApp then rejects.
        const domain = {
          ...td.domain,
          ...(td.domain?.chainId != null ? { chainId: Number(td.domain.chainId) } : {}),
        };
        signature = (await wallet.account.signTypedData({
          domain,
          types,
          primaryType: td.primaryType,
          message: td.message,
        } as never)) as Hex;
      } else {
        const rawMessage = (sig.method === "personal_sign" ? params[0] : params[1]) as Hex;
        signature = (await wallet.account.signMessage({ message: { raw: rawMessage } })) as Hex;
      }
      updateItem(id, { state: "approved" });
      bridges.current.get(id)?.onSigned(signature);
      bridges.current.delete(id);
      return signature;
    },
    [updateItem],
  );

  const pending = useMemo(
    () => queue.filter((q) => q.state !== "approved" && q.state !== "rejected"),
    [queue],
  );

  const api = useMemo<Api>(
    () => ({
      queue,
      pending,
      toasts,
      dismissToast,
      approve,
      reject,
      push,
      submitLive,
      submitAgentInstallReview,
      signLive,
      submitSignatureRequest,
      signSignatureRequest,
      byId: (id: string) => queue.find((x) => x.id === id),
    }),
    [
      queue,
      pending,
      toasts,
      dismissToast,
      approve,
      reject,
      push,
      submitLive,
      submitAgentInstallReview,
      signLive,
      submitSignatureRequest,
      signSignatureRequest,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApprovalQueue(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApprovalQueue must be used inside <ApprovalQueueProvider>");
  return v;
}

// Translate a GuardianVerdict into the QueueItem fields we display, leaving
// the live `tx` untouched and bumping the live stage to "ready".
function applyVerdict(item: QueueItem, v: GuardianVerdict): Partial<QueueItem> {
  if (!item.live) return {};
  const sim = v.simulation;
  const findings = v.findings.map((f) => ({ sev: f.severity, title: f.title, detail: f.detail }));
  const requiresTyping = v.risk === "high" || v.risk === "critical";

  // Build asset-diff with both sides explicitly labelled — "from your wallet"
  // for the user's outflow and "to 0xabc…" for the counterparty's inflow.
  const fromAddr = item.live.tx.from.toLowerCase();
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const rows: QueueItem["assetDiff"] = [];
  if (sim) {
    // Sort so the user's delta lands first (negatives at the top read naturally).
    const sortedDeltas = [...sim.balanceDelta].sort((a, b) => {
      const aMine = a.address.toLowerCase() === fromAddr ? 0 : 1;
      const bMine = b.address.toLowerCase() === fromAddr ? 0 : 1;
      return aMine - bMine;
    });
    for (const b of sortedDeltas) {
      const wei = BigInt(b.deltaWei);
      if (wei === 0n) continue;
      const isMine = b.address.toLowerCase() === fromAddr;
      rows.push({
        sym: isMine ? "ETH from your wallet" : `ETH to ${short(b.address)}`,
        delta: Number(wei) / 1e18,
        fiat: null,
      });
    }
    for (const t of sim.erc20Transfers) {
      const fromMine = t.from.toLowerCase() === fromAddr;
      const toMine = t.to.toLowerCase() === fromAddr;
      if (!fromMine && !toMine) continue;
      const tokenShort = `${t.token.slice(0, 6)}…`;
      const sym = fromMine
        ? `${tokenShort} to ${short(t.to)}`
        : `${tokenShort} from ${short(t.from)}`;
      rows.push({
        sym,
        delta: ((fromMine ? -1 : 1) * Number(BigInt(t.amount))) / 1e6,
        fiat: null,
      });
    }
  }
  // Fall back to the placeholder ETH diff if simulation produced nothing.
  const assetDiff = rows.length > 0 ? rows : item.assetDiff;

  const gasUsed = sim ? Number(BigInt(sim.gasUsed)) : 0;
  const gas = sim ? `${gasUsed.toLocaleString()} gas` : "—";

  // Derive counterparty kind from findings.
  const findingIds = new Set(v.findings.map((f) => f.id));
  const kind: "verified" | "unverified" | "eoa" = findingIds.has("eoa-recipient")
    ? "eoa"
    : findingIds.has("unverified-target") || findingIds.has("etherscan-unavailable")
      ? "unverified"
      : "verified";
  const counterparty: QueueItem["counterparty"] = {
    name: item.counterparty.name,
    verified: kind === "verified",
    kind,
    age: kind === "eoa" ? "wallet address" : kind === "unverified" ? "unverified" : "verified",
    contracts: item.counterparty.contracts,
  };

  return {
    why: v.summary,
    reasoning: v.llm?.reasoning,
    investigation: v.llm?.investigation,
    checkReasoning: v.llm?.checkReasoning,
    checks: v.checks.map((c) => ({ kind: c.kind, ok: c.ok, title: c.title, detail: c.detail })),
    risk: v.risk,
    impacts: v.impacts,
    findings,
    assetDiff,
    counterparty,
    sim: { gas, reverts: sim ? !sim.success : false },
    requiresTyping,
    live: { ...item.live, stage: "ready" },
  };
}
