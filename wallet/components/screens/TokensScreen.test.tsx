import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TokensScreen } from "@/components/screens/TokensScreen";
import type { Address } from "viem";
import type { TokenHolding } from "@/types/core";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";

const mocks = vi.hoisted(() => ({
  wallet: {
    state: {
      kind: "unlocked" as const,
      wallet: { address: "0x1111111111111111111111111111111111111111" as Address },
    },
  },
  autoInvestPlugin: {
    installation: null as unknown,
    status: null as unknown,
    statusHtml: null as string | null,
    error: null as string | null,
    loading: false,
    refresh: vi.fn(),
  },
  tokenPortfolio: {
    holdings: [] as TokenHolding[],
    totalUsdValue: null as number | null,
    loading: false,
    error: null as string | null,
    refresh: vi.fn(),
  },
}));

vi.mock("@/hooks/useWallet", () => ({ useWallet: () => mocks.wallet }));
vi.mock("@/hooks/useAgentPluginStatus", () => ({
  useAgentPluginStatus: () => mocks.autoInvestPlugin,
}));
vi.mock("@/hooks/useTokenPortfolio", () => ({ useTokenPortfolio: () => mocks.tokenPortfolio }));

const ethHolding: TokenHolding = {
  chainId: 1,
  tokenAddress: NATIVE_TOKEN_ADDRESS,
  amount: "1",
  decimals: 18,
  usdAmount: 4000,
  name: "Ethereum",
  symbol: "ETH",
  owner: "0x1111111111111111111111111111111111111111" as Address,
};

describe("TokensScreen", () => {
  it("keeps the net worth visible while refreshing existing holdings", () => {
    mocks.tokenPortfolio.holdings = [ethHolding];
    mocks.tokenPortfolio.totalUsdValue = 4250;
    mocks.tokenPortfolio.loading = true;

    render(
      <TokensScreen onSelectToken={vi.fn()} onSendToken={vi.fn()} onOpenAutoInvest={vi.fn()} />,
    );

    expect(screen.getByText("$4,250")).toBeInTheDocument();
    expect(screen.queryByText("...")).toBeNull();
  });
});
