"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { WalletPageShell } from "@/components/WalletPageShell";
import { AgentsScreen } from "@/components/screens/AgentsScreen";
import { AutoInvestScreen } from "@/components/screens/AutoInvestScreen";

function AgentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");

  return (
    <WalletPageShell route="agent" eyebrow="Agents" title="Agents">
      {view === "auto-invest" ? (
        <AutoInvestScreen onBack={() => router.push("/agent")} />
      ) : (
        <AgentsScreen
          onOpenAutoInvest={() => router.push("/agent?view=auto-invest")}
          onOpenInboxItem={(id) => router.push(`/inbox?item=${encodeURIComponent(id)}`)}
        />
      )}
    </WalletPageShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AgentPageContent />
    </Suspense>
  );
}
