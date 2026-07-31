import { describe, it, expect } from "vitest";
import { extractStringField } from "./partial-json";

describe("extractStringField", () => {
  it("returns undefined when the key has not appeared yet", () => {
    expect(extractStringField('{"foo":', "summary")).toBeUndefined();
  });

  it("returns partial value when buffer is truncated mid-value", () => {
    expect(extractStringField('{"summary":"Hel', "summary")).toBe("Hel");
  });

  it("returns the complete value when closed", () => {
    expect(extractStringField('{"summary":"Hello"}', "summary")).toBe("Hello");
  });

  it("handles escaped quote inside value", () => {
    expect(extractStringField('{"summary":"a \\"b\\" c"}', "summary")).toBe('a "b" c');
  });

  it("handles escaped backslash inside value", () => {
    expect(extractStringField('{"summary":"a\\\\b"}', "summary")).toBe("a\\b");
  });

  it("decodes \\uXXXX escape sequences", () => {
    expect(extractStringField('{"summary":"caf\\u00e9"}', "summary")).toBe("café");
  });

  it("does not emit the trailing lone backslash mid-buffer (escape pending)", () => {
    // Buffer ends in `\` which could be the start of \" or \\ — wait.
    expect(extractStringField('{"summary":"abc\\', "summary")).toBe("abc");
  });

  it("extracts reasoning even when summary appears earlier", () => {
    const buf = '{"summary":"hi","impacts":[],"risk":"low","reasoning":"because"}';
    expect(extractStringField(buf, "reasoning")).toBe("because");
  });

  it("ignores the key when it appears inside another string", () => {
    const buf = '{"summary":"this mentions reasoning here","reasoning":"real"}';
    expect(extractStringField(buf, "reasoning")).toBe("real");
  });

  it("returns undefined when the key only appears inside another string", () => {
    expect(
      extractStringField('{"summary":"contains reasoning word"}', "reasoning"),
    ).toBeUndefined();
  });
});
