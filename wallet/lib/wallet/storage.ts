import { getDB, STORE_WALLETS as STORE } from "@/lib/db";
import { SINGLETON_ID } from "@/lib/constants/wallet";
import type { Address } from "viem";

export type WalletKind = "passkey" | "injected";

export type StoredInjectedWalletConnection = {
  kind: "injected";
  address: Address;
  rdns?: string;
  connectedAt: number;
};

export type StoredPasskeyWallet = {
  kind?: "passkey";
  id: string;
  address: Address;
  credentialId: Uint8Array;
  ciphertext: Uint8Array;
  iv: Uint8Array;
  hkdfSalt: Uint8Array;
  prfSalt: Uint8Array;
  activeInjectedWallet?: StoredInjectedWalletConnection;
  createdAt: number;
};

export type StoredInjectedWallet = {
  kind: "injected";
  id: string;
  address: Address;
  rdns?: string;
  createdAt: number;
};

export type StoredWallet = StoredPasskeyWallet | StoredInjectedWallet;

export function storedWalletKind(wallet: StoredWallet): WalletKind {
  return wallet.kind === "injected" ? "injected" : "passkey";
}

export function activeWalletKind(wallet: StoredWallet): WalletKind {
  return wallet.kind === "injected" || wallet.activeInjectedWallet ? "injected" : "passkey";
}

export async function saveWallet(w: StoredWallet): Promise<void> {
  const d = await getDB();
  await d.put(STORE, w, SINGLETON_ID);
}

export async function saveActiveInjectedWallet(
  connection: StoredInjectedWalletConnection,
): Promise<void> {
  const existing = await loadWallet();
  if (existing && existing.kind !== "injected") {
    await saveWallet({ ...existing, activeInjectedWallet: connection });
  } else {
    await saveWallet({
      kind: "injected",
      id: existing?.id ?? crypto.randomUUID(),
      address: connection.address,
      rdns: connection.rdns,
      createdAt: existing?.createdAt ?? connection.connectedAt,
    });
  }
}

export async function loadWallet(): Promise<StoredWallet | null> {
  const d = await getDB();
  return ((await d.get(STORE, SINGLETON_ID)) as StoredWallet | undefined) ?? null;
}

export async function deleteWallet(): Promise<void> {
  const d = await getDB();
  await d.delete(STORE, SINGLETON_ID);
}
