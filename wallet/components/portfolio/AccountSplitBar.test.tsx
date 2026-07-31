import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSplitBar } from "@/components/portfolio/AccountSplitBar";

afterEach(() => cleanup());

describe("AccountSplitBar", () => {
  it("renders nothing when only one segment has non-zero value", () => {
    const { container } = render(
      <AccountSplitBar
        segments={[
          { id: "main", label: "Main wallet", value: 100, gradient: "main" },
          { id: "agent", label: "Sprout", value: 0, gradient: "sprout" },
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when total is zero", () => {
    const { container } = render(
      <AccountSplitBar
        segments={[
          { id: "main", label: "Main wallet", value: 0, gradient: "main" },
          { id: "agent", label: "Sprout", value: 0, gradient: "sprout" },
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders both segments and percentages when ≥ 2 are non-zero", () => {
    render(
      <AccountSplitBar
        segments={[
          { id: "main", label: "Main wallet", value: 8500, gradient: "main" },
          { id: "agent", label: "Sprout", value: 1500, gradient: "sprout" },
        ]}
      />,
    );
    expect(screen.getByText(/Main wallet/)).toBeInTheDocument();
    expect(screen.getByText(/Sprout/)).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();
    expect(screen.getByText(/15%/)).toBeInTheDocument();
  });
});
