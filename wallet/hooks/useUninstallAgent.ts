"use client";
import { useCallback, useState } from "react";
import { postAgentUninstall } from "@/lib/agent-plugins/client";
import { deleteAgentInstallation, type AgentInstallation } from "@/lib/agent-plugins/store";

type UninstallState = {
  uninstalling: boolean;
  error: string | null;
  result: string | null;
};

const IDLE: UninstallState = { uninstalling: false, error: null, result: null };

// Drains managed funds back to the main wallet via the agent service's
// /uninstall endpoint, then drops the local installation record. Shared by the
// agents grid and the auto-invest detail screen so the teardown behaves
// identically wherever it's triggered.
export function useUninstallAgent(
  installation: AgentInstallation | null,
  onUninstalled: () => Promise<void> | void,
) {
  const [state, setState] = useState<UninstallState>(IDLE);

  // Resolves to true when the teardown succeeded, so callers can branch (e.g.
  // close a confirm prompt) without re-reading the async state.
  const uninstall = useCallback(async (): Promise<boolean> => {
    if (!installation) return false;
    setState({ uninstalling: true, error: null, result: null });
    try {
      if (!installation.mallowMainWallet) {
        throw new Error("This built-in agent has no permission account to uninstall.");
      }
      const result = await postAgentUninstall(
        installation.serviceUrl,
        installation.mallowMainWallet,
      );
      if (result.kind !== "uninstalled") {
        throw new Error(result.error ?? result.kind);
      }
      await deleteAgentInstallation(installation.pluginId, installation.mallowMainWallet);
      await onUninstalled();
      const usdc = (Number(result.transferred ?? "0") / 1_000_000).toFixed(2);
      setState({
        uninstalling: false,
        error: null,
        result: result.userOpHash
          ? `Returned ${usdc} USDC to your main wallet.`
          : "Uninstalled. No balances to return.",
      });
      return true;
    } catch (e) {
      setState({
        uninstalling: false,
        error: e instanceof Error ? e.message : "Could not uninstall the agent.",
        result: null,
      });
      return false;
    }
  }, [installation, onUninstalled]);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, uninstall, reset };
}
