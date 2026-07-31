"use client";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { WalletProvider } from "@/hooks/useWallet";
import { ApprovalQueueProvider } from "@/hooks/useApprovalQueue";
import { WalletConnectProvider } from "@/hooks/useWalletConnect";

export function Providers({ children }: { children: ReactNode }) {
  // Create a QueryClient instance per request/session to prevent state leakage
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <ApprovalQueueProvider>
            <WalletConnectProvider>{children}</WalletConnectProvider>
          </ApprovalQueueProvider>
        </WalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
