import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    status: "ready",
    sessions: [] as unknown[],
    pendingProposal: null as unknown,
    pair: vi.fn(async () => {}),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
    disconnect: vi.fn(),
  },
}));
vi.mock("@/hooks/useWalletConnect", () => ({ useWalletConnect: () => mocks.state }));

import { ConnectionsScreen } from "./ConnectionsScreen";

afterEach(() => cleanup());

describe("ConnectionsScreen", () => {
  it("rejects an invalid uri inline and does not call pair", () => {
    render(<ConnectionsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/wc:/i), { target: { value: "https://nope" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(screen.getByText(/not a walletconnect/i)).toBeInTheDocument();
    expect(mocks.state.pair).not.toHaveBeenCalled();
  });

  it("calls pair with a valid wc: uri", () => {
    render(<ConnectionsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/wc:/i), { target: { value: "wc:abc@2" } });
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(mocks.state.pair).toHaveBeenCalledWith("wc:abc@2");
  });
});
