import { Fragment, type ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { openPythonLab } from "./with-python-split";

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={i++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code key={i++} className="rounded bg-background/80 px-1 py-0.5 font-mono text-[11px] text-primary">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const label = token.slice(1, token.indexOf("]"));
      const href = token.slice(token.indexOf("(") + 1, -1);
      parts.push(
        <a key={i++} href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseTable(lines: string[]) {
  const rows = lines
    .filter((l) => !/^\s*\|?\s*-{2,}/.test(l))
    .map((l) =>
      l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim()),
    )
    .filter((r) => r.some((c) => c.length > 0));
  if (rows.length < 2) return null;
  const [head, ...body] = rows;
  return { head: head!, body };
}

export function MarkdownMessage({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i += 1;
      }
      i += 1;
      const source = code.join("\n");
      blocks.push(
        <div key={k++} className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">{lang || "code"}</span>
            <div className="flex flex-wrap gap-1.5">
              <CopyButton value={source} label="Copy code" copiedLabel="Copied code" />
              <button
                type="button"
                onClick={() => openPythonLab(source)}
                className="inline-flex items-center rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary hover:text-foreground"
              >
                Run in lab
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {source}
          </pre>
        </div>,
      );
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && /\|/.test(lines[i + 1] ?? "")) {
      const tableLines = [line];
      i += 1;
      while (i < lines.length && lines[i]!.includes("|")) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      const table = parseTable(tableLines);
      if (table) {
        blocks.push(
          <div key={k++} className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[320px] text-left text-xs">
              <thead className="bg-background/70">
                <tr>
                  {table.head.map((h) => (
                    <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-subtle">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.body.map((row, ri) => (
                  <tr key={ri} className="border-t border-border">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-muted-foreground">
                        {inline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s/, "");
      const cls =
        level === 1
          ? "font-display text-base font-bold tracking-tight"
          : level === 2
            ? "font-display text-sm font-semibold tracking-tight text-primary"
            : "text-xs font-semibold uppercase tracking-[0.14em] text-subtle";
      blocks.push(
        <p key={k++} className={`${cls} pt-1`}>
          {inline(text)}
        </p>,
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const items: { ordered: boolean; text: string }[] = [];
      while (i < lines.length && (/^\s*[-*]\s/.test(lines[i]!) || /^\s*\d+\.\s/.test(lines[i]!))) {
        const cur = lines[i]!;
        items.push({
          ordered: /^\s*\d+\./.test(cur),
          text: cur.replace(/^\s*(?:[-*]|\d+\.)\s/, ""),
        });
        i += 1;
      }
      const ordered = items[0]?.ordered;
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k++} className={`space-y-1.5 pl-4 text-sm leading-relaxed text-muted-foreground ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, ii) => (
            <li key={ii} className="pl-0.5">
              {inline(item.text)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^#{1,3}\s/.test(lines[i]!) &&
      !/^\s*[-*]\s/.test(lines[i]!) &&
      !/^\s*\d+\.\s/.test(lines[i]!) &&
      !lines[i]!.startsWith("```") &&
      !lines[i]!.trim().startsWith("|")
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push(
      <p key={k++} className="text-sm leading-relaxed text-foreground/90">
        {para.map((p, pi) => (
          <Fragment key={pi}>
            {pi > 0 && " "}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="space-y-3">{blocks}</div>;
}
