import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { TxReviewScreen } from "./TxReviewScreen";
import type { QueueItem } from "@/types/queue";

// Auto-cleanup is not wired up (vitest `globals` is off), so unmount between
// tests to keep each assertion scoped to its own render.
afterEach(cleanup);

vi.mock("@/hooks/useApprovalQueue", () => ({
  useApprovalQueue: () => ({
    approve: vi.fn(),
    reject: vi.fn(),
    signLive: vi.fn(),
    signSignatureRequest: vi.fn(),
  }),
}));
vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({ state: { kind: "locked", address: "0xEoa" } }),
}));

const sigItem = {
  id: "sig-1",
  agent: "self",
  proposedAt: "now",
  proposedAtMs: 0,
  intent: "Sign a message for Uniswap",
  why: "Uniswap is asking you to sign.",
  risk: "info",
  assetDiff: [],
  counterparty: { name: "Uniswap", verified: false, age: "app.uniswap.org", contracts: 0 },
  impacts: [],
  findings: [],
  sim: { gas: "—", reverts: false },
  requiresTyping: false,
  signatureReview: {
    method: "personal_sign",
    account: "0xEoa",
    origin: { name: "Uniswap", url: "https://app.uniswap.org" },
    view: { kind: "message", text: "Sign in to Uniswap" },
    raw: ["0x", "0xEoa"],
  },
} as unknown as QueueItem;

const typedData = {
  domain: {
    name: "Permit2",
    chainId: 8453,
    verifyingContract: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  },
  types: { PermitSingle: [{ name: "spender", type: "address" }] },
  primaryType: "PermitSingle",
  message: { spender: "0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7" },
};

// An eth_signTypedData_v4 review that runs Guardian against the verifying
// contract — item.live is populated, so the screen must treat it like a live
// transaction review.
const typedSigItemBase = {
  ...sigItem,
  id: "sig-2",
  intent: "Sign typed data for Uniswap",
  signatureReview: {
    method: "eth_signTypedData_v4",
    account: "0xEoa",
    origin: { name: "Uniswap", url: "https://app.uniswap.org" },
    view: { kind: "typedData", typedData },
    raw: ["0xEoa", JSON.stringify(typedData)],
  },
  live: {
    tx: { from: "0xEoa", to: "0x000000000022d473030f116ddee9f6b43ac78ba3", value: "0", data: "0x" },
    stage: "plan",
    chainId: 8453,
    actions: [],
  },
} as unknown as QueueItem;

describe("TxReviewScreen signature variant", () => {
  it("renders the decoded message and a sign affordance", () => {
    render(<TxReviewScreen item={sigItem} onClose={vi.fn()} />);
    expect(screen.getByText(/Sign in to Uniswap/)).toBeInTheDocument();
    expect(screen.getByText(/Signature request/i)).toBeInTheDocument();
  });

  it("shows Guardian progress (not the verdict) while a typed-data review is running", () => {
    render(<TxReviewScreen item={typedSigItemBase} onClose={vi.fn()} />);
    // Live-review affordance, gated on the Guardian stage (appears in both the
    // status pill and the approve button).
    expect(screen.getAllByText(/Waiting for Guardian/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Reading your transaction/i)).toBeInTheDocument();
    // The verdict cards and the raw typed-data card stay hidden until ready.
    expect(screen.queryByText(/How Guardian checked this/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Signature request/i)).not.toBeInTheDocument();
  });

  it("renders the Guardian analysis once a typed-data review is ready", () => {
    const ready = {
      ...typedSigItemBase,
      id: "sig-3",
      risk: "high",
      why: "Authorizes an unlimited Permit2 allowance.",
      reasoning: "The spender is an unverified address; the amount is unlimited.",
      impacts: ["Lets the spender move unlimited tokens from your wallet."],
      checks: [
        {
          kind: "signature",
          ok: false,
          title: "Permit2 token allowance",
          detail: "Unlimited allowance to spender.",
        },
      ],
      findings: [
        {
          sev: "high",
          title: "Signature grants an unlimited token allowance",
          detail: "No further approval needed.",
        },
      ],
      live: { ...(typedSigItemBase as { live: object }).live, stage: "ready" },
    } as unknown as QueueItem;

    render(<TxReviewScreen item={ready} onClose={vi.fn()} />);
    expect(screen.getByText(/How Guardian checked this/i)).toBeInTheDocument();
    expect(screen.getByText(/Signature grants an unlimited token allowance/i)).toBeInTheDocument();
    expect(screen.getByText(/Lets the spender move unlimited tokens/i)).toBeInTheDocument();
    // The raw typed data is shown alongside the verdict.
    expect(screen.getAllByText(/Signature request/i).length).toBeGreaterThan(0);
  });
});
