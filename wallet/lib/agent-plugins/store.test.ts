import { describe, expect, it } from "vitest";
import { loadAgentInstallation, saveAgentInstallation } from "./store";

describe("agent plugin installations", () => {
  it("stores installation by plugin id", async () => {
    await saveAgentInstallation({
      pluginId: "auto-invest",
      serviceUrl: "http://localhost:8787",
      mallowMainWallet: "0x1111111111111111111111111111111111111111",
      agentId: "sprout-11111111",
      installedAt: 1,
      request: {
        name: "Sprout",
        description: "Moves idle USDC.",
        accounts: [],
        actions: [
          {
            kind: "tx",
            chainId: 8453,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            value: "0",
          },
        ],
      },
    });

    expect(
      (await loadAgentInstallation("auto-invest", "0x1111111111111111111111111111111111111111"))
        ?.agentId,
    ).toBe("sprout-11111111");
  });
});
