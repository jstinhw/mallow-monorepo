"use client";
import type { Address } from "viem";
import { SoftCard } from "@/components/ui";
import { portfolioTotalLabel } from "@/lib/wallet/portfolio-display";
import { buildAccountSummaries } from "@/lib/wallet/portfolio-accounts";
import { AccountSplitBar } from "@/components/portfolio/AccountSplitBar";
import { AccountRow } from "@/components/portfolio/AccountRow";
import type { TokenHolding } from "@/types/core";

type AutoInvestSnapshot = {
  enabled: boolean;
  protocolId: "aave" | "morpho" | null;
  aprPercent: number | null;
};

type Props = {
  holdings: TokenHolding[];
  totalUsdValue: number | null;
  loading: boolean;
  investmentAgentAddress?: Address | null;
  autoInvest?: AutoInvestSnapshot | null;
  onSend: () => void;
  onManage: () => void;
  onGoAutoInvest: () => void;
};

export function PortfolioWidget({
  holdings,
  totalUsdValue,
  loading,
  investmentAgentAddress,
  autoInvest,
  onSend,
  onManage,
  onGoAutoInvest,
}: Props) {
  const visibleHoldings = holdings;
  const totalLabel = portfolioTotalLabel(totalUsdValue, visibleHoldings);
  const showLoadingLabel = loading && visibleHoldings.length === 0;

  const summaries = buildAccountSummaries({
    holdings: visibleHoldings,
    totalUsdValue,
    investmentAgentAddress: investmentAgentAddress ?? null,
    autoInvest: autoInvest ?? null,
  });

  return (
    <SoftCard padding={28}>
      <div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Total portfolio
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 64,
            fontWeight: 400,
            letterSpacing: "-0.025em",
            lineHeight: 1,
            marginTop: 8,
          }}
        >
          {showLoadingLabel ? "…" : totalLabel}
        </div>
      </div>

      <AccountSplitBar
        segments={summaries.map((s) => ({
          id: s.agentId ?? s.kind,
          label: s.name,
          value: s.balanceUsd ?? 0,
          gradient: s.kind === "wallet" ? "main" : "sprout",
        }))}
      />

      <div style={{ marginTop: 18 }}>
        {summaries.map((s, i) => (
          <AccountRow
            key={s.agentId ?? s.kind}
            summary={s}
            isFirst={i === 0}
            onSelect={() => (s.kind === "wallet" ? onManage() : onGoAutoInvest())}
            onAction={() => {
              if (s.action.kind === "send") onSend();
              else onGoAutoInvest();
            }}
          />
        ))}
      </div>
    </SoftCard>
  );
}
