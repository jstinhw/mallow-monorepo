import { beforeEach, describe, expect, it } from "vitest";
import { getDB, STORE_AGENT_INSTALLATIONS } from "@/lib/db";
import { loadAgentInstallation } from "./store";
import { seedDefaultInstallations } from "./seed";

describe("seedDefaultInstallations", () => {
  beforeEach(async () => {
    const d = await getDB();
    await d.clear(STORE_AGENT_INSTALLATIONS);
  });

  it("creates a builtin record for always-on guardian when absent", async () => {
    await seedDefaultInstallations();
    const rec = await loadAgentInstallation("guardian");
    expect(rec?.builtin).toBe(true);
    expect(rec?.pluginId).toBe("guardian");
  });

  it("does not overwrite an existing record", async () => {
    await seedDefaultInstallations();
    const first = await loadAgentInstallation("guardian");
    await seedDefaultInstallations();
    const second = await loadAgentInstallation("guardian");
    expect(second?.installedAt).toBe(first?.installedAt);
  });
});
