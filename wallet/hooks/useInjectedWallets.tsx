"use client";
import { useEffect, useState } from "react";
import { subscribeToInjectedWallets, type EIP6963ProviderDetail } from "@/lib/wallet/eip6963";

// Returns the browser wallets (MetaMask, Rainbow, …) discovered via EIP-6963,
// updating as each one announces itself.
export function useInjectedWallets(): EIP6963ProviderDetail[] {
  const [wallets, setWallets] = useState<EIP6963ProviderDetail[]>([]);
  useEffect(() => subscribeToInjectedWallets(setWallets), []);
  return wallets;
}
