"use client";
import { WalletPageShell } from "@/components/WalletPageShell";
import { ConnectionsScreen } from "@/components/screens/ConnectionsScreen";

export default function ConnectionsPage() {
  return (
    <WalletPageShell route="connections" eyebrow="Connections" title="Connect to dApps">
      <ConnectionsScreen />
    </WalletPageShell>
  );
}
