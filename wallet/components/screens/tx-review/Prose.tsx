"use client";
import type { ReactNode } from "react";
import { INLINE } from "@/lib/constants/prose";

// Minimal markdown renderer for Guardian's generated prose. Supports the subset
// the model emits: blank-line paragraphs, "-"/"*" bullet lists, **bold**, and
// `inline code`. Builds React elements directly — no HTML injection, no deps.

type Block = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "p", lines: para });
      para = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else {
      para.push(line);
    }
  }
  flushPara();
  return blocks;
}

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  fontSize: "0.88em",
  background: "var(--surface-2)",
  borderRadius: 5,
  padding: "1px 5px",
  wordBreak: "break-all",
};

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} style={codeStyle}>
          {m[3]}
        </code>,
      );
    }
    lastIndex = m.index + m[0].length;
    i++;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Prose({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {blocks.map((b, i) =>
        b.kind === "ul" ? (
          <ul
            key={i}
            style={{
              margin: 0,
              paddingLeft: 20,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 14,
              color: "var(--ink-1)",
              lineHeight: 1.6,
            }}
          >
            {b.items.map((it, j) => (
              <li key={j}>{renderInline(it, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: 0, fontSize: 14, color: "var(--ink-1)", lineHeight: 1.6 }}>
            {b.lines.map((ln, j) => (
              <span key={j}>
                {renderInline(ln, `${i}-${j}`)}
                {j < b.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
