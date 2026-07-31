"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AGENTS, AGENT_TONES, type GlyphName } from "@/lib/agent-plugins/agents";
import type { RiskLevel } from "@/types/guardian";

export function Glyph({
  name,
  size = 18,
  stroke = 1.6,
  className = "",
}: {
  name: GlyphName | string;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor" as const,
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  switch (name) {
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
        </svg>
      );
    case "leaf":
      return (
        <svg {...common}>
          <path d="M5 19c0-9 6-14 15-14-1 9-6 14-15 14z" />
          <path d="M5 19c4-3 7-6 9-9" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9z" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <path d="M3 13l3-8h12l3 8v6H3v-6z" />
          <path d="M3 13h5l1 2h6l1-2h5" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4" />
          <path d="M3 4v4h4" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="14" r="4" />
          <path d="M11 11l9-9M17 5l3 3M14 8l3 3" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M3 11l18-8-7 18-3-7-8-3z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12l5 5 9-12" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case "fingerprint":
      return (
        <svg {...common}>
          <path d="M5 12a7 7 0 0114 0v3" />
          <path d="M9 21c-1-2-1-4-1-7a4 4 0 018 0c0 3 0 5-1 7" />
          <path d="M12 11v4c0 2-.5 4-1 6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 16V11a6 6 0 1112 0v5l2 3H4l2-3z" />
          <path d="M10 20a2 2 0 004 0" />
        </svg>
      );
    case "merge":
      return (
        <svg {...common}>
          <path d="M8 3v6c0 3 2 5 5 5h7" />
          <path d="M16 11l4 3-4 3" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M3 7h15a3 3 0 013 3v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          <path d="M3 7V6a2 2 0 012-2h11" />
          <circle cx="17" cy="14" r="1.5" fill="currentColor" />
        </svg>
      );
    case "log-out":
      return (
        <svg {...common}>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" x2="9" y1="12" y2="12" />
        </svg>
      );
    default:
      return null;
  }
}

const RISK_MAP: Record<RiskLevel, { bg: string; fg: string; label: string }> = {
  info: { bg: "var(--c-info)", fg: "var(--c-info-ink)", label: "Info" },
  low: { bg: "var(--c-low)", fg: "var(--c-low-ink)", label: "Low" },
  medium: { bg: "var(--c-med)", fg: "var(--c-med-ink)", label: "Caution" },
  high: { bg: "var(--c-high)", fg: "var(--c-high-ink)", label: "High" },
  critical: { bg: "var(--c-crit)", fg: "var(--c-crit-ink)", label: "Critical" },
};

export function RiskChip({ risk, size = "md" }: { risk: RiskLevel; size?: "sm" | "md" | "lg" }) {
  const m = RISK_MAP[risk] ?? RISK_MAP.info;
  const px = size === "sm" ? "6px 10px" : size === "lg" ? "8px 14px" : "6px 12px";
  const fs = size === "sm" ? 11 : size === "lg" ? 13 : 12;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: m.bg,
        color: m.fg,
        padding: px,
        borderRadius: 999,
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: m.fg, opacity: 0.85 }} />
      {m.label}
    </span>
  );
}

export function AgentBadge({
  agentId,
  size = 32,
  ring = false,
}: {
  agentId: string;
  size?: number;
  ring?: boolean;
}) {
  const a =
    AGENTS[agentId] ??
    (agentId === "self" ? { glyph: "key" as const, tone: "ink" as const, name: "You" } : null);
  if (!a) return null;
  const [bg, fg] = AGENT_TONES[a.tone] ?? AGENT_TONES.ink;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: fg,
        boxShadow: ring ? "0 0 0 3px var(--surface-1)" : "inset 0 -1px 0 rgba(0,0,0,0.04)",
        flexShrink: 0,
      }}
    >
      <Glyph name={a.glyph} size={Math.round(size * 0.5)} stroke={1.8} />
    </span>
  );
}

export type AssetDiffRowProp = {
  sym: string;
  delta: number | "∞";
  fiat: number | null;
  hostile?: boolean;
};

// Picks fraction digits adaptive to magnitude: < 0.001 → up to 8 digits,
// < 1 → up to 6, else → up to 4. Trailing zeros are dropped.
function formatAmount(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const max = abs < 0.001 ? 8 : abs < 1 ? 6 : 4;
  return n.toLocaleString(undefined, { maximumFractionDigits: max });
}

export function AssetDiff({ rows, dense = false }: { rows: AssetDiffRowProp[]; dense?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: dense ? 4 : 8,
        padding: dense ? "10px 12px" : "14px 16px",
        background: "var(--surface-2)",
        borderRadius: 14,
      }}
    >
      {rows.map((r, i) => {
        const isInf = typeof r.delta === "string" && r.delta === "∞";
        const positive = !isInf && (r.delta as number) > 0;
        const color = r.hostile ? "var(--c-crit-ink)" : positive ? "var(--c-pos)" : "var(--c-neg)";
        const sign = isInf ? "∞" : positive ? "+" : "";
        const val = isInf
          ? "Unlimited"
          : `${sign}${formatAmount(Math.abs(r.delta as number))} ${r.sym}`;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: dense ? 13 : 14,
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", color, fontWeight: 600 }}>
              {r.hostile && "⚠ "}
              {val}
            </span>
            {r.fiat !== null && r.fiat !== undefined && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--ink-3)",
                  fontSize: dense ? 12 : 13,
                }}
              >
                {r.fiat > 0 ? "+" : ""}${Math.abs(r.fiat).toFixed(2)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SoftCard({
  children,
  style,
  onClick,
  padding = 20,
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  padding?: number;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface-1)",
        borderRadius: 22,
        padding,
        boxShadow: "var(--shadow-soft)",
        border: "1px solid var(--surface-edge)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type BtnKind = "primary" | "soft" | "ghost" | "danger" | "accent";
export type BtnSize = "sm" | "md" | "lg";

const BTN_STYLES: Record<BtnKind, { bg: string; fg: string; border: string }> = {
  primary: { bg: "var(--ink-1)", fg: "var(--surface-0)", border: "var(--ink-1)" },
  soft: { bg: "var(--surface-2)", fg: "var(--ink-1)", border: "transparent" },
  ghost: { bg: "transparent", fg: "var(--ink-2)", border: "var(--surface-edge)" },
  danger: { bg: "var(--c-crit-ink)", fg: "#fff", border: "var(--c-crit-ink)" },
  accent: { bg: "var(--accent)", fg: "var(--surface-0)", border: "var(--accent)" },
};

export function Btn({
  kind = "primary",
  onClick,
  children,
  full = false,
  disabled = false,
  size = "md",
  icon,
  type = "button",
}: {
  kind?: BtnKind;
  onClick?: () => void;
  children?: ReactNode;
  full?: boolean;
  disabled?: boolean;
  size?: BtnSize;
  icon?: GlyphName;
  type?: "button" | "submit";
}) {
  const s = BTN_STYLES[kind] ?? BTN_STYLES.primary;
  const pad = size === "sm" ? "8px 14px" : size === "lg" ? "14px 22px" : "11px 18px";
  const fs = size === "sm" ? 13 : size === "lg" ? 15 : 14;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: full ? "100%" : "auto",
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        borderRadius: 999,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        letterSpacing: "0.005em",
        transition: "transform 120ms ease, opacity 120ms ease",
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      {icon && <Glyph name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

export function CopyButton({
  value,
  size = 14,
  label = "Copy address",
  tone = "ghost",
}: {
  value: string | null | undefined;
  size?: number;
  label?: string;
  tone?: "ghost" | "soft";
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const disabled = !value;
  const onClick = async () => {
    if (!value) return;
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 1600);
  };

  const pad = Math.max(4, Math.round(size * 0.45));
  const palette =
    tone === "soft"
      ? { bg: "var(--surface-2)", fg: "var(--ink-2)", border: "transparent" }
      : { bg: "transparent", fg: "var(--ink-3)", border: "var(--surface-edge)" };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={failed ? "Copy failed" : copied ? "Copied" : label}
      title={failed ? "Copy failed" : copied ? "Copied" : label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: pad,
        borderRadius: 999,
        background: palette.bg,
        color: copied ? "var(--c-low-ink)" : palette.fg,
        border: `1px solid ${palette.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        lineHeight: 0,
        transition: "color 140ms ease, background 140ms ease",
      }}
    >
      <Glyph name={copied ? "check" : "copy"} size={size} />
    </button>
  );
}

export function MallowMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <defs>
        <radialGradient id="ml-grad" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#f1e5d2" />
        </radialGradient>
      </defs>
      <circle
        cx="32"
        cy="34"
        r="26"
        fill="url(#ml-grad)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <ellipse cx="24" cy="28" rx="3" ry="4" fill="var(--accent-ink)" opacity="0.7" />
      <ellipse cx="40" cy="28" rx="3" ry="4" fill="var(--accent-ink)" opacity="0.7" />
      <path
        d="M24 40c2 3 6 4 8 4s6-1 8-4"
        stroke="var(--accent-ink)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
    </svg>
  );
}
