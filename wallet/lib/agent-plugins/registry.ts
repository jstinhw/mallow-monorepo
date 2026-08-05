export type AgentPluginRegistryEntry = {
  id: string;
  name: string;
  description: string;
  serviceUrl: string;
  agentKey: string;
};

export const AGENT_PLUGINS: Record<string, AgentPluginRegistryEntry> = {
  guardian: {
    id: "guardian",
    name: "Guardian",
    description: "Reviews every transaction before you sign.",
    serviceUrl: process.env.NEXT_PUBLIC_GUARDIAN_AGENT_URL ?? "http://localhost:3003",
    agentKey: "guardian",
  },
  "auto-invest": {
    id: "auto-invest",
    name: "Sprout",
    description: "Moves idle USDC into vetted yield venues.",
    serviceUrl: process.env.NEXT_PUBLIC_AUTO_INVEST_AGENT_URL ?? "http://localhost:8787",
    agentKey: "yield",
  },
};

export function getAgentPlugin(id: string): AgentPluginRegistryEntry {
  const plugin = AGENT_PLUGINS[id];
  if (!plugin) throw new Error(`Unknown agent plugin: ${id}`);
  return plugin;
}
