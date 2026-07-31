"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WalletPageShell } from "@/components/WalletPageShell";
import { TokensScreen } from "@/components/screens/TokensScreen";
import { TokenDetailPanel } from "@/components/screens/TokenDetailPanel";
import { SendTokenScreen } from "@/components/screens/SendTokenScreen";

function TokenPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const token = searchParams.get("token");
  const chainId = searchParams.get("chainId");
  const parsedChainId = chainId ? Number(chainId) : null;
  const initialChainId =
    parsedChainId !== null && Number.isFinite(parsedChainId) ? parsedChainId : null;
  const sendInitialTokenKey = token ?? null;

  return (
    <WalletPageShell route="token" eyebrow="Tokens" title="Tokens">
      {view === "detail" && token ? (
        <TokenDetailPanel
          tokenKey={token}
          onBack={() => router.push("/token")}
          onSend={(key, nextChainId) => {
            const params = new URLSearchParams();
            params.set("view", "send");
            params.set("token", key);
            if (nextChainId !== undefined) params.set("chainId", String(nextChainId));
            router.push(`/token?${params.toString()}`);
          }}
        />
      ) : view === "send" ? (
        <SendTokenScreen
          initialTokenKey={sendInitialTokenKey}
          initialChainId={initialChainId}
          onClose={() => router.push("/token")}
          onOpenItem={(id) => router.push(`/inbox?item=${encodeURIComponent(id)}`)}
        />
      ) : (
        <TokensScreen
          onSelectToken={(key) =>
            router.push(`/token?view=detail&token=${encodeURIComponent(key)}`)
          }
          onSendToken={(key, nextChainId) => {
            const params = new URLSearchParams();
            params.set("view", "send");
            if (key) params.set("token", key);
            if (nextChainId !== undefined) params.set("chainId", String(nextChainId));
            router.push(`/token?${params.toString()}`);
          }}
          onOpenAutoInvest={() => router.push("/agent?view=auto-invest")}
        />
      )}
    </WalletPageShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <TokenPageContent />
    </Suspense>
  );
}
