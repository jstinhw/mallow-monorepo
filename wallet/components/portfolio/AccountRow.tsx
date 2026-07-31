"use client";
import type { MouseEvent } from "react";
import { Glyph } from "@/components/ui";
import { formatUsd } from "@/lib/wallet/portfolio-display";
import type { AccountSummary, AccountAction } from "@/lib/wallet/portfolio-accounts";

const AVATAR_BG: Record<"main" | "sprout" | "muted", string> = {
  main: "var(--acc-main-grad)",
  sprout: "var(--acc-sprout-grad)",
  muted: "var(--surface-2)",
};

const ACTION_LABEL: Record<AccountAction["kind"], string> = {
  send: "Send",
  "manage-agent": "Manage",
  "setup-agent": "Set up →",
};

export function AccountRow({
  summary,
  isFirst = false,
  onSelect,
  onAction,
}: {
  summary: AccountSummary;
  isFirst?: boolean;
  onSelect: () => void;
  onAction: () => void;
}) {
  return (
    <div
      role="button"
      aria-label={summary.name}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 8px",
        marginLeft: -8,
        marginRight: -8,
        borderTop: isFirst ? "none" : "1px solid var(--surface-edge)",
        cursor: "pointer",
        borderRadius: 10,
        transition: "background 140ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Avatar avatar={summary.avatar} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              color:
                summary.avatar.kind === "agent" && summary.avatar.gradient === "muted"
                  ? "var(--ink-2)"
                  : "var(--ink-1)",
            }}
          >
            {summary.name}
          </span>
          {summary.subLabel && (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }}>· {summary.subLabel}</span>
          )}
        </div>
        <BodyLine body={summary.body} />
      </div>
      <Trailing trailing={summary.trailing} />
      <ActionButton
        kind={summary.action.kind}
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
      />
    </div>
  );
}

function ActionButton({
  kind,
  onClick,
}: {
  kind: AccountAction["kind"];
  onClick: (e: MouseEvent) => void;
}) {
  const isPrimary = kind === "send" || kind === "setup-agent";
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 12px",
        borderRadius: 999,
        border: isPrimary ? "1px solid var(--ink-1)" : "1px solid var(--surface-edge-strong)",
        background: isPrimary ? "var(--ink-1)" : "transparent",
        color: isPrimary ? "var(--surface-1)" : "var(--ink-2)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {kind === "send" && <Glyph name="send" size={11} />}
      {ACTION_LABEL[kind]}
    </button>
  );
}

function Avatar({ avatar }: { avatar: AccountSummary["avatar"] }) {
  const bg = AVATAR_BG[avatar.gradient];
  return (
    <span
      style={{
        width: 38,
        height: 38,
        borderRadius: 999,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: avatar.kind === "agent" && avatar.gradient === "muted" ? "var(--ink-3)" : "white",
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.04)",
      }}
    >
      {avatar.kind === "agent" && <Glyph name={avatar.glyph} size={18} stroke={1.8} />}
    </span>
  );
}

function BodyLine({ body }: { body: AccountSummary["body"] }) {
  switch (body.kind) {
    case "token-chips":
      return (
        <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
          {body.chips.map((c) => (
            <span
              key={c.symbol}
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 999,
                background: "var(--surface-2)",
                color: "var(--ink-2)",
                fontWeight: 600,
              }}
            >
              {c.symbol} · {c.humanAmount}
            </span>
          ))}
          {body.moreCount > 0 && (
            <span
              style={{ fontSize: 10, color: "var(--ink-3)", fontWeight: 600, alignSelf: "center" }}
            >
              +{body.moreCount} more
            </span>
          )}
        </div>
      );
    case "agent-status": {
      const text =
        body.aprPercent === null
          ? `Earning in ${body.protocol}`
          : `Earning ${body.aprPercent.toFixed(2)}% APY in ${body.protocol}`;
      return (
        <div
          style={{
            fontSize: 12,
            color: "var(--c-pos)",
            marginTop: 3,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--c-pos)",
              display: "inline-block",
              animation: "ml-sprout-pulse 2s ease-in-out infinite",
            }}
          />
          {text}
        </div>
      );
    }
    case "discovery":
    case "empty":
      return <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>{body.copy}</div>;
  }
}

function Trailing({ trailing }: { trailing: AccountSummary["trailing"] }) {
  if (trailing.kind === "none") return null;
  return (
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 400,
          letterSpacing: "-0.01em",
        }}
      >
        {trailing.usd === null ? "—" : formatUsd(trailing.usd)}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{trailing.sub}</div>
    </div>
  );
}
