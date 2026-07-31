"use client";
import { WalletPageShell } from "@/components/WalletPageShell";
import { ActivityScreen } from "@/components/screens/ActivityScreen";

export default function Page() {
  return (
    <WalletPageShell route="activity" eyebrow="Activity" title="Activity">
      <ActivityScreen />
    </WalletPageShell>
  );
}
