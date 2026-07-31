export type AgentTone = "sage" | "moss" | "ink";

export type Agent = {
  id: string;
  name: string;
  role: string;
  blurb: string;
  glyph: GlyphName;
  tone: AgentTone;
  always?: boolean;
  persona: string;
};

export type GlyphName =
  | "shield"
  | "leaf"
  | "home"
  | "inbox"
  | "history"
  | "spark"
  | "key"
  | "send"
  | "settings"
  | "check"
  | "x"
  | "arrow"
  | "fingerprint"
  | "plus"
  | "bell"
  | "merge"
  | "copy"
  | "wallet";

export const AGENTS: Record<string, Agent> = {
  guardian: {
    id: "guardian",
    name: "Guardian",
    role: "Security review",
    blurb: "Reads every transaction before you sign. Simulates, decodes, flags risk.",
    glyph: "shield",
    tone: "sage",
    always: true,
    persona: "Quiet. Direct. Never sleeps.",
  },
  yield: {
    id: "yield",
    name: "Sprout",
    role: "Yield gardener",
    blurb: "Moves idle stables into vetted vaults. Pulls them back when rates dip.",
    glyph: "leaf",
    tone: "moss",
    persona: "Patient. Compounds slowly.",
  },
};

export const AGENT_TONES: Record<AgentTone, [string, string]> = {
  sage: ["#e8f0e2", "#3d6b3a"],
  moss: ["#e2ecdb", "#3a5a2c"],
  ink: ["#ece6dc", "#3a342b"],
};
