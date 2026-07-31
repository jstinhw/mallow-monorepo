"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import {
  activeWalletKind,
  deleteWallet,
  loadWallet,
  saveWallet,
  type WalletKind,
  type StoredWallet,
} from "@/lib/wallet/storage";
import {
  clearPasskeySession,
  connectInjectedWallet,
  createWallet,
  exportPrivateKey,
  restoreConnectedWallet,
  restorePasskeySessionWallet,
  type UnlockedWallet,
} from "@/lib/wallet/wallet";
import type { Eip1193Provider } from "@/lib/wallet/eip6963";
import type { Address, Hex } from "viem";

export type WalletState =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "locked"; address: Address; walletKind?: WalletKind }
  | { kind: "unlocked"; wallet: UnlockedWallet };

type WalletApi = {
  state: WalletState;
  create: () => Promise<void>;
  connect: (opts?: { provider?: Eip1193Provider; rdns?: string }) => Promise<void>;
  unlock: () => Promise<void>;
  exportPrivateKey: () => Promise<Hex>;
  lock: () => void;
  logout: () => Promise<void>;
};

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, connector, status } = useConnection();
  const connect = useConnect();
  const connectors = useConnectors();
  const disconnect = useDisconnect();

  const [unlockedWallet, setUnlockedWallet] = useState<UnlockedWallet | null>(null);
  const [dbState, setDbState] = useState<{ loading: boolean; storedWallet: StoredWallet | null }>({
    loading: true,
    storedWallet: null,
  });

  const refreshDbState = useCallback(async () => {
    const w = await loadWallet();
    setDbState({ loading: false, storedWallet: w });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDbState();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDbState]);

  useEffect(() => {
    if (!isConnected || !connector || !address) {
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      if (connector.id === "passkey") {
        const conn = connectors.find((c) => c.id === "passkey") ?? connector;
        const getUnlockedWallet = (conn as { getUnlockedWallet?: () => UnlockedWallet | null })
          .getUnlockedWallet;
        if (typeof getUnlockedWallet === "function") {
          const unlocked = getUnlockedWallet();
          if (unlocked) {
            setUnlockedWallet(unlocked);
          }
        }
      } else if (typeof connector.getProvider === "function") {
        connector.getProvider().then((provider) => {
          if (!alive) return;
          connectInjectedWallet({ provider: provider as Eip1193Provider, rdns: connector.id }).then(
            (w) => {
              if (alive) setUnlockedWallet(w);
            },
          );
        });
      }
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [isConnected, connector, address, connectors]);

  useEffect(() => {
    if (dbState.loading || !dbState.storedWallet || unlockedWallet) return;

    let alive = true;
    const restore =
      activeWalletKind(dbState.storedWallet) === "injected"
        ? restoreConnectedWallet
        : restorePasskeySessionWallet;

    const timer = window.setTimeout(() => {
      restore().then((wallet) => {
        if (alive && wallet) setUnlockedWallet(wallet);
      });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [dbState.loading, dbState.storedWallet, unlockedWallet]);

  // Wagmi status-to-WalletState mapper
  let state: WalletState = { kind: "loading" };

  if (status === "reconnecting" || dbState.loading) {
    state = { kind: "loading" };
  } else if (!dbState.storedWallet) {
    state = { kind: "absent" };
  } else if (!unlockedWallet) {
    const activeInjectedWallet =
      dbState.storedWallet.kind === "injected"
        ? dbState.storedWallet
        : dbState.storedWallet.activeInjectedWallet;
    state = {
      kind: "locked",
      address: activeInjectedWallet?.address ?? dbState.storedWallet.address,
      walletKind: activeWalletKind(dbState.storedWallet),
    };
  } else {
    state = { kind: "unlocked", wallet: unlockedWallet };
  }

  const create = useCallback(async () => {
    await createWallet();
    await refreshDbState();
    const conn = connectors.find((c) => c.id === "passkey");
    if (conn) {
      await connect.mutateAsync({ connector: conn });
    }
    await refreshDbState();
  }, [connectors, connect.mutateAsync, refreshDbState]);

  const connectWallet = useCallback(
    async (opts?: { provider?: Eip1193Provider; rdns?: string }) => {
      if (opts?.provider) {
        const wallet = await connectInjectedWallet({ provider: opts.provider, rdns: opts.rdns });
        setUnlockedWallet(wallet);
        await refreshDbState();
        return;
      }

      const conn =
        connectors.find((c) => c.id === opts?.rdns) ?? connectors.find((c) => c.id === "injected");
      if (conn) {
        await connect.mutateAsync({ connector: conn });
      }
      await refreshDbState();
    },
    [connectors, connect.mutateAsync, refreshDbState],
  );

  const unlock = useCallback(async () => {
    const conn = connectors.find((c) => c.id === "passkey");
    if (conn) {
      await connect.mutateAsync({ connector: conn });
    }
    await refreshDbState();
  }, [connectors, connect.mutateAsync, refreshDbState]);

  const lock = useCallback(() => {
    setUnlockedWallet(null);
    clearPasskeySession();
    void disconnect.mutateAsync();
  }, [disconnect.mutateAsync]);

  const logout = useCallback(async () => {
    const w = await loadWallet();
    if (w) {
      if (w.kind === "injected") {
        await deleteWallet();
      } else {
        if (w.activeInjectedWallet) {
          delete w.activeInjectedWallet;
          await saveWallet(w);
        }
      }
    }
    setUnlockedWallet(null);
    clearPasskeySession();
    await disconnect.mutateAsync();
    await refreshDbState();
  }, [disconnect.mutateAsync, refreshDbState]);

  return (
    <Ctx.Provider
      value={{ state, create, connect: connectWallet, unlock, exportPrivateKey, lock, logout }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
