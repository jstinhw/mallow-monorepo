import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortfolioWidget } from "@/components/PortfolioWidget";
import type { Address } from "viem";
import type { TokenHolding } from "@/types/core";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/constants";

const SMART = "0x2222222222222222222222222222222222222222" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;

const ethMain: TokenHolding = {
  chainId: 1,
  tokenAddress: NATIVE_TOKEN_ADDRESS,
  amount: "1",
  decimals: 18,
  usdAmount: 4000,
  name: "Ethereum",
  symbol: "ETH",
  owner: OWNER,
};

afterEach(() => cleanup());

describe("PortfolioWidget", () => {
  it("renders the total portfolio label and value", () => {
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4250}
        loading={false}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={vi.fn()}
      />,
    );
    expect(screen.getByText("Total portfolio")).toBeInTheDocument();
    expect(screen.getByText("$4,250")).toBeInTheDocument();
  });

  it("keeps the last total visible while refreshing existing holdings", () => {
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4250}
        loading={true}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={vi.fn()}
      />,
    );
    expect(screen.getByText("$4,250")).toBeInTheDocument();
    expect(screen.queryByText("…")).toBeNull();
  });

  it("hides the split bar when only one account has balance", () => {
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={vi.fn()}
      />,
    );
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it("renders the discovery Sprout row when no agent address is set", () => {
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={vi.fn()}
      />,
    );
    expect(screen.getByText(/Earn ~4-5% on idle USDC/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set up/ })).toBeInTheDocument();
  });

  it("clicking the Send button on the Main row calls onSend", () => {
    const onSend = vi.fn();
    const onManage = vi.fn();
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        onSend={onSend}
        onManage={onManage}
        onGoAutoInvest={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onManage).not.toHaveBeenCalled();
  });

  it("clicking the Main row body calls onManage", () => {
    const onManage = vi.fn();
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        onSend={vi.fn()}
        onManage={onManage}
        onGoAutoInvest={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Main wallet"));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it("clicking the Set up button on discovery row calls onGoAutoInvest", () => {
    const onGoAutoInvest = vi.fn();
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={onGoAutoInvest}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Set up/ }));
    expect(onGoAutoInvest).toHaveBeenCalledTimes(1);
  });

  it("does NOT render the raw smart account address", () => {
    render(
      <PortfolioWidget
        holdings={[ethMain]}
        totalUsdValue={4000}
        loading={false}
        investmentAgentAddress={SMART}
        autoInvest={{ enabled: true, protocolId: "aave", aprPercent: 4.81 }}
        onSend={vi.fn()}
        onManage={vi.fn()}
        onGoAutoInvest={vi.fn()}
      />,
    );
    expect(screen.queryByText(SMART)).toBeNull();
  });
});
