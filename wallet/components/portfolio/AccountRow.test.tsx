import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountRow } from "@/components/portfolio/AccountRow";
import type { AccountSummary } from "@/lib/wallet/portfolio-accounts";

afterEach(() => cleanup());

const mainSummary: AccountSummary = {
  kind: "wallet",
  name: "Main wallet",
  avatar: { kind: "wallet", gradient: "main" },
  balanceUsd: 6000,
  share: 0.76,
  body: {
    kind: "token-chips",
    chips: [
      { symbol: "ETH", humanAmount: "1.74" },
      { symbol: "USDC", humanAmount: "4,210" },
    ],
    moreCount: 0,
  },
  trailing: { kind: "balance", usd: 6000, sub: "2 tokens" },
  action: { kind: "send" },
};

const sproutActive: AccountSummary = {
  kind: "investment-agent",
  agentId: "yield",
  name: "Sprout",
  subLabel: "auto-invest",
  avatar: { kind: "agent", glyph: "leaf", gradient: "sprout" },
  balanceUsd: 1917,
  share: 0.24,
  body: { kind: "agent-status", protocol: "Aave V3 USDC", aprPercent: 4.81 },
  trailing: { kind: "balance", usd: 1917, sub: "aUSDC" },
  action: { kind: "manage-agent" },
};

const sproutDiscovery: AccountSummary = {
  kind: "investment-agent",
  agentId: "yield",
  name: "Sprout",
  subLabel: "auto-invest",
  avatar: { kind: "agent", glyph: "leaf", gradient: "muted" },
  balanceUsd: null,
  share: 0,
  body: { kind: "discovery", copy: "Earn ~4-5% on idle USDC, auto-managed" },
  trailing: { kind: "none" },
  action: { kind: "setup-agent" },
};

describe("AccountRow", () => {
  it("renders Main row with token chips and Send action", () => {
    render(<AccountRow summary={mainSummary} onSelect={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText("Main wallet")).toBeInTheDocument();
    expect(screen.getByText(/ETH/)).toBeInTheDocument();
    expect(screen.getByText(/4,210/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument();
  });

  it("renders active Sprout row with status line and Manage action", () => {
    render(<AccountRow summary={sproutActive} onSelect={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText("Sprout")).toBeInTheDocument();
    expect(screen.getByText(/4.81% APY in Aave V3 USDC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manage/ })).toBeInTheDocument();
  });

  it("renders status line without APR when aprPercent is null", () => {
    const noApr: AccountSummary = {
      ...sproutActive,
      body: { kind: "agent-status", protocol: "Aave V3 USDC", aprPercent: null },
    };
    render(<AccountRow summary={noApr} onSelect={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText(/Earning in Aave V3 USDC/)).toBeInTheDocument();
  });

  it("renders discovery row with Set up action and no balance", () => {
    render(<AccountRow summary={sproutDiscovery} onSelect={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText(/Earn ~4-5% on idle USDC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up/ })).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("fires onSelect when the row body is clicked", () => {
    const onSelect = vi.fn();
    render(<AccountRow summary={mainSummary} onSelect={onSelect} onAction={vi.fn()} />);
    fireEvent.click(screen.getByText("Main wallet"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("fires onAction (not onSelect) when the action button is clicked", () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(<AccountRow summary={mainSummary} onSelect={onSelect} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
