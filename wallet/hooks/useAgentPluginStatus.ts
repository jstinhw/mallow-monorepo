"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchAgentStatus, fetchAgentStatusHtml } from "@/lib/agent-plugins/client";
import { loadAgentInstallation, type AgentInstallation } from "@/lib/agent-plugins/store";

export function useAgentPluginStatus(pluginId: string, mallowMainWallet?: string | null) {
  const [installation, setInstallation] = useState<AgentInstallation | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<unknown>(null);
  const [statusHtml, setStatusHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const value = await loadAgentInstallation(pluginId, mallowMainWallet);
      setInstallation(value);
      if (!value) {
        // Plugin removed — drop any stale status the polling effect cached so
        // the UI doesn't keep showing balances for a uninstalled agent.
        setStatus(null);
        setStatusHtml(null);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, [pluginId, mallowMainWallet]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!installation) return;
    let stopped = false;
    const tick = async () => {
      try {
        const [next, html] = await Promise.all([
          fetchAgentStatus(
            installation.serviceUrl,
            installation.mallowMainWallet || mallowMainWallet,
          ),
          fetchAgentStatusHtml(
            installation.serviceUrl,
            installation.mallowMainWallet || mallowMainWallet,
          ).catch(() => null),
        ]);
        if (!stopped) {
          setStatus(next);
          setStatusHtml(html);
          setError(null);
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : "status fetch failed");
      }
    };

    void tick();
    const interval = window.setInterval(tick, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [installation, mallowMainWallet]);

  return { installation, status, statusHtml, error, loading, refresh };
}
