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
import { useApprovalQueue, type RequestBridge } from "@/hooks/useApprovalQueue";
import { useWallet } from "@/hooks/useWallet";
import {
  isWalletConnectConfigured,
  getWalletKit,
  pair as wcPair,
  approveSession,
  rejectSession,
  respondResult,
  respondError,
  disconnectSession,
} from "@/lib/walletconnect/client";
import {
  txParamToGuardianInput,
  classifySignature,
  requestChainId,
  isRequestExpired,
  type TxParam,
} from "@/lib/walletconnect/requests";
import { SIGN_METHODS } from "@/lib/constants/walletconnect";
import type { Address, Hex } from "viem";

export type WcStatus = "disabled" | "connecting" | "ready" | "error";

export type WcSession = { topic: string; name: string; url: string; icon?: string };

export type PendingProposal = {
  id: number;
  name: string;
  url: string;
  icon?: string;
  chains: string[];
  proposalParams: unknown;
};

type Api = {
  status: WcStatus;
  sessions: WcSession[];
  pendingProposal: PendingProposal | null;
  pair: (uri: string) => Promise<void>;
  approveProposal: () => Promise<void>;
  rejectProposal: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
};

const Ctx = createContext<Api | null>(null);

export function WalletConnectProvider({ children }: { children: ReactNode }) {
  const { submitLive, submitSignatureRequest } = useApprovalQueue();
  const { state } = useWallet();
  const eoa =
    state.kind === "unlocked"
      ? state.wallet.address
      : state.kind === "locked"
        ? state.address
        : null;
  const eoaRef = useRef<Address | null>(eoa);
  useEffect(() => {
    eoaRef.current = eoa;
  }, [eoa]);

  const [status, setStatus] = useState<WcStatus>(
    isWalletConnectConfigured() ? "connecting" : "disabled",
  );
  const [sessions, setSessions] = useState<WcSession[]>([]);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);

  const refreshSessions = useCallback(async () => {
    const kit = await getWalletKit();
    const active = kit.getActiveSessions();
    setSessions(
      Object.values(active).map((s) => ({
        topic: s.topic,
        name: s.peer.metadata.name,
        url: s.peer.metadata.url,
        icon: s.peer.metadata.icons?.[0],
      })),
    );
  }, []);

  useEffect(() => {
    if (!isWalletConnectConfigured()) return;
    let cancelled = false;
    let boundKit: Awaited<ReturnType<typeof getWalletKit>> | null = null;

    const onProposal = (proposal: {
      id: number;
      params: {
        proposer: { metadata: { name: string; url: string; icons?: string[] } };
        requiredNamespaces?: { eip155?: { chains?: string[] } };
      };
    }) => {
      const md = proposal.params.proposer.metadata;
      setPendingProposal({
        id: proposal.id,
        name: md.name,
        url: md.url,
        icon: md.icons?.[0],
        chains: proposal.params.requiredNamespaces?.eip155?.chains ?? [],
        proposalParams: proposal.params,
      });
    };

    const onRequest = async (event: {
      topic: string;
      id: number;
      params: {
        chainId: string;
        request: { method: string; params: unknown[]; expiryTimestamp?: number };
      };
    }) => {
      const { topic, id, params } = event;
      try {
        // If the request arrived already past its expiry, the relay has dropped
        // it — running Guardian and then responding would only fail with
        // "Record was recently deleted". Bail out cleanly instead.
        if (isRequestExpired(params.request)) {
          void respondError(topic, id, "Request expired before it could be reviewed.");
          return;
        }
        const chainId = requestChainId(params.chainId);
        const method = params.request.method;
        const bridge: RequestBridge = {
          onSigned: (result: Hex) => {
            void respondResult(topic, id, result);
          },
          onRejected: () => {
            void respondError(topic, id);
          },
        };
        const peer = boundKit?.getActiveSessions()[topic]?.peer.metadata;
        const origin = { name: peer?.name ?? "dApp", url: peer?.url ?? "", icon: peer?.icons?.[0] };

        if (method === "eth_sendTransaction") {
          const txParam = params.request.params[0] as TxParam;
          submitLive(txParamToGuardianInput(txParam, chainId), bridge);
        } else if (SIGN_METHODS.has(method)) {
          const c = classifySignature(method, params.request.params);
          submitSignatureRequest(
            {
              method: method as "personal_sign",
              account: c.account,
              chainId,
              origin,
              view:
                c.kind === "message"
                  ? { kind: "message", text: c.text }
                  : { kind: "typedData", typedData: c.typedData },
              raw: params.request.params,
            },
            bridge,
          );
        } else if (method === "wallet_switchEthereumChain") {
          void respondResult(topic, id, null);
        } else {
          void respondError(topic, id, `Unsupported method: ${method}`);
        }
      } catch (err) {
        void respondError(topic, id, err instanceof Error ? err.message : "Request failed");
      }
    };

    const onDelete = () => {
      void refreshSessions();
    };

    (async () => {
      try {
        const kit = await getWalletKit();
        if (cancelled) return;
        boundKit = kit;
        kit.on("session_proposal", onProposal);
        kit.on("session_request", onRequest);
        kit.on("session_delete", onDelete);
        await refreshSessions();
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (boundKit) {
        boundKit.off("session_proposal", onProposal);
        boundKit.off("session_request", onRequest);
        boundKit.off("session_delete", onDelete);
      }
    };
  }, [refreshSessions, submitLive, submitSignatureRequest]);

  const pair = useCallback(async (uri: string) => {
    await wcPair(uri);
  }, []);

  const approveProposal = useCallback(async () => {
    if (!pendingProposal) return;
    if (!eoaRef.current) throw new Error("Unlock your wallet before connecting.");
    await approveSession({
      id: pendingProposal.id,
      proposalParams: pendingProposal.proposalParams as Parameters<
        typeof approveSession
      >[0]["proposalParams"],
      eoa: eoaRef.current,
    });
    setPendingProposal(null);
    await refreshSessions();
  }, [pendingProposal, refreshSessions]);

  const rejectProposal = useCallback(async () => {
    if (!pendingProposal) return;
    await rejectSession(pendingProposal.id);
    setPendingProposal(null);
  }, [pendingProposal]);

  const disconnect = useCallback(
    async (topic: string) => {
      await disconnectSession(topic);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const api = useMemo<Api>(
    () => ({
      status,
      sessions,
      pendingProposal,
      pair,
      approveProposal,
      rejectProposal,
      disconnect,
    }),
    [status, sessions, pendingProposal, pair, approveProposal, rejectProposal, disconnect],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWalletConnect(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWalletConnect must be used inside <WalletConnectProvider>");
  return v;
}
