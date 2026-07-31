"use client";
import { useRouter } from "next/navigation";
import { WalletPageShell } from "@/components/WalletPageShell";
import { HomeScreen } from "@/components/screens/HomeScreen";

export default function Page() {
  const router = useRouter();

  return (
    <WalletPageShell route="home" eyebrow="Home" title="Good morning.">
      <HomeScreen
        onOpenItem={(id) => router.push(`/inbox?item=${encodeURIComponent(id)}`)}
        onGoQueue={() => router.push("/inbox")}
        onGoActivity={() => router.push("/activity")}
        onGoSend={() => router.push("/token?view=send")}
        onGoTokens={() => router.push("/token")}
        onGoAutoInvest={() => router.push("/agent?view=auto-invest")}
      />
    </WalletPageShell>
  );
}
