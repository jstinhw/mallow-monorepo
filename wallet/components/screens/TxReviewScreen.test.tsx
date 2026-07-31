import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TxReviewScreen } from "@/components/screens/TxReviewScreen";
import type { QueueItem } from "@/types/queue";

const mocks = vi.hoisted(() => ({
  approvalQueue: {
    approve: vi.fn(),
    reject: vi.fn(),
    signLive: vi.fn(),
  },
  wallet: {
    state: { kind: "locked" as const },
  },
}));

vi.mock("@/hooks/useApprovalQueue", () => ({
  useApprovalQueue: () => mocks.approvalQueue,
}));

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => mocks.wallet,
}));

describe("TxReviewScreen", () => {
  it("shows a completed declined state after the user declines a review", () => {
    const item: QueueItem = {
      id: "q-test",
      agent: "guardian",
      proposedAt: "5 min ago",
      proposedAtMs: Date.now() - 5 * 60_000,
      intent: "You: approve unlimited USDC to 0xdEaD…",
      why: "Guardian intercepted before broadcast.",
      risk: "critical",
      assetDiff: [],
      counterparty: { name: "0x000000…00dEaD", verified: false, age: "unverified", contracts: 0 },
      impacts: [],
      findings: [],
      sim: { gas: "0.0004 ETH", reverts: false },
      requiresTyping: true,
      state: "rejected",
    };

    render(<TxReviewScreen item={item} onClose={vi.fn()} />);

    expect(screen.getByText("Declined.")).toBeInTheDocument();
    expect(screen.getByText("This transaction was not signed or broadcast.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to inbox" })).toBeInTheDocument();
  });
});
