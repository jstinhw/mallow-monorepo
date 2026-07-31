import { describe, expect, it } from "vitest";
import { formatTokenAmount, formatUsd, portfolioTotalLabel } from "./portfolio-display";

describe("formatTokenAmount", () => {
  it("shows four decimals when the balance is less than one", () => {
    expect(formatTokenAmount("0.1")).toBe("0.1000");
  });

  it("does not round tiny nonzero ETH balances down to zero", () => {
    expect(formatTokenAmount("0.00001")).toBe("0.00001");
  });
});

describe("formatUsd", () => {
  it("shows four decimals for nonzero values below one dollar", () => {
    expect(formatUsd(0.1234)).toBe("$0.1234");
  });

  it("keeps whole-dollar display for values of at least one dollar", () => {
    expect(formatUsd(1234.56)).toBe("$1,235");
  });
});

describe("portfolioTotalLabel", () => {
  it("shows four decimals for total USD value below one dollar", () => {
    expect(portfolioTotalLabel(0.12, [])).toBe("$0.1200");
  });
});
