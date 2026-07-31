import type { Address } from "viem";
import type { AgentInstallation } from "./store";

// Derived views over the installed-agent state and the agent service's remote
// /status payload. The installation record is the single source of truth for
// what's installed; these selectors read the agent-specific bits out of it and
// the live status so the screens don't each re-implement the shape.

export function pluginSmartAccountAddress(installation: AgentInstallation | null): Address | null {
  if (!installation) return null;
  const smartAccount = installation.request?.accounts.find(
    (account) => account.type === "smart_account",
  );
  return (smartAccount?.address as Address | undefined) ?? null;
}

export type PluginAutoInvestSnapshot = {
  enabled: boolean;
  protocolId: "aave" | "morpho" | null;
  aprPercent: number | null;
};

export function pluginAutoInvestSnapshot(status: unknown): PluginAutoInvestSnapshot | null {
  if (!status || typeof status !== "object") return null;
  const s = status as Record<string, unknown>;
  if (!s.installed) return null;
  const protocolId =
    s.currentProtocol === "aave" || s.currentProtocol === "morpho" ? s.currentProtocol : null;
  const aprPercent = typeof s.currentApr === "number" ? s.currentApr : null;
  return {
    enabled: s.enabled !== false,
    protocolId,
    aprPercent,
  };
}
