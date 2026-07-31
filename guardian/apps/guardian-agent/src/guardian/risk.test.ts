import { describe, it, expect } from "vitest";
import { maxRisk, makeFinding } from "./risk";

describe("maxRisk", () => {
  it("returns the highest of N risks", () => {
    expect(maxRisk(["info", "low", "high", "medium"])).toBe("high");
  });
  it("returns info when empty", () => {
    expect(maxRisk([])).toBe("info");
  });
  it("treats null as info", () => {
    expect(maxRisk([null, "medium"])).toBe("medium");
  });
});

describe("makeFinding", () => {
  it("normalizes id to kebab-case", () => {
    const f = makeFinding({
      id: "Infinite_Approval",
      severity: "high",
      title: "x",
      detail: "y",
    });
    expect(f.id).toBe("infinite-approval");
  });
});
