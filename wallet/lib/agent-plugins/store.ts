import { getDB, STORE_AGENT_INSTALLATIONS as STORE } from "@/lib/db";
import type { AgentRequest } from "@mallow/agents-protocol";

export type AgentInstallation = {
  pluginId: string;
  serviceUrl: string;
  mallowMainWallet?: `0x${string}`;
  agentId?: string;
  request?: AgentRequest;
  installedAt: number;
  builtin?: boolean;
};

export async function saveAgentInstallation(installation: AgentInstallation): Promise<void> {
  const d = await getDB();
  const key = installation.mallowMainWallet
    ? `${installation.mallowMainWallet.toLowerCase()}_${installation.pluginId}`
    : installation.pluginId;
  await d.put(STORE, installation, key);
}

export async function loadAgentInstallation(
  pluginId: string,
  mallowMainWallet?: string | null,
): Promise<AgentInstallation | null> {
  const d = await getDB();
  const key = mallowMainWallet ? `${mallowMainWallet.toLowerCase()}_${pluginId}` : pluginId;
  return ((await d.get(STORE, key)) as AgentInstallation | undefined) ?? null;
}

export async function deleteAgentInstallation(
  pluginId: string,
  mallowMainWallet?: string | null,
): Promise<void> {
  const d = await getDB();
  const key = mallowMainWallet ? `${mallowMainWallet.toLowerCase()}_${pluginId}` : pluginId;
  await d.delete(STORE, key);
}
