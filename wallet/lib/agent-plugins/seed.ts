import { AGENTS } from "./agents";
import { loadAgentInstallation, saveAgentInstallation } from "./store";
import { AGENT_PLUGINS } from "./registry";

export async function seedDefaultInstallations(): Promise<void> {
  for (const agent of Object.values(AGENTS)) {
    if (!agent.always) continue;
    const plugin = AGENT_PLUGINS[agent.id];
    if (!plugin) continue;
    const existing = await loadAgentInstallation(plugin.id);
    if (existing) continue;
    await saveAgentInstallation({
      pluginId: plugin.id,
      serviceUrl: plugin.serviceUrl,
      installedAt: Date.now(),
      builtin: true,
    });
  }
}
