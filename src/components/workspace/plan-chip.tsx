import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Sliders,
  AlertTriangle,
  Copy,
  Check,
} from "lucide-react";
import type { QueryOp, QueryResult } from "@/lib/dataset-query";

export type PlanChipTrace = {
  version: 1;
  datasetName: string;
  versionLabel?: string;
  sheetName?: string | null;
  processing: "standard" | "large" | "in-memory";
  ops: QueryOp[];
  summary: string;
  results: QueryResult[];
  timestamp: string;
};

const TRACE_PREFIX = "<!--datasimplr-trace:\n";
const TRACE_SUFFIX = "\n-->";

/**
 * Embeds structured plan and calculation traceability into the assistant message string.
 * This persists in the database without requiring schema changes.
 */
export function encodeMessageWithTrace(reply: string, trace?: PlanChipTrace | null): string {
  if (!trace || !trace.ops?.length) return reply;
  try {
    return `${TRACE_PREFIX}${JSON.stringify(trace)}${TRACE_SUFFIX}\n\n${reply}`;
  } catch (err) {
    console.error("Failed to encode plan trace:", err);
    return reply;
  }
}

/**
 * Extracts plan and calculation traceability from assistant message content.
 */
export function parseMessageTrace(content: string): { cleanContent: string; trace: PlanChipTrace | null } {
  if (!content || !content.startsWith(TRACE_PREFIX)) {
    return { cleanContent: content, trace: null };
  }
  const endIdx = content.indexOf(TRACE_SUFFIX);
  if (endIdx === -1) {
    return { cleanContent: content, trace: null };
  }
  const jsonStr = content.slice(TRACE_PREFIX.length, endIdx);
  const cleanContent = content.slice(endIdx + TRACE_SUFFIX.length).trimStart();
  try {
    const trace = JSON.parse(jsonStr) as PlanChipTrace;
    return { cleanContent, trace };
  } catch (err) {
    console.error("Failed to parse plan trace:", err);
    return { cleanContent: content, trace: null };
  }
}

function formatFilter(f: { column: string; op: string; value: string | number | (string | number)[] }): string {
  const val = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
  const opMap: Record<string, string> = {
    eq: "=",
    neq: "≠",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    contains: "contains",
    in: "in",
  };
  return `${f.column} ${opMap[f.op] ?? f.op} ${val}`;
}

/**
 * Generates a concise, high-signal human-readable summary of an individual operation.
 * E.g. "Group by Region · Sum Revenue (Top 5)"
 */
export function summarizeOp(op: QueryOp): string {
  const filterDesc =
    "filters" in op && Array.isArray(op.filters) && op.filters.length > 0
      ? ` [where ${op.filters.map(formatFilter).join(" & ")}]`
      : "";

  switch (op.op) {
    case "describe":
      return "Profile columns & summary stats";
    case "quality":
      return "Data-quality scan & issues";
    case "aggregate":
      return `${op.agg.toUpperCase()}(${op.metric ?? "count"})${filterDesc}`;
    case "group": {
      const metricStr = op.metric ? ` · ${op.agg.toUpperCase()}(${op.metric})` : ` · ${op.agg.toUpperCase()}(rows)`;
      const limitStr = op.limit ? ` (top ${op.limit})` : "";
      return `Group by ${op.groupBy.join(", ")}${metricStr}${limitStr}${filterDesc}`;
    }
    case "top_n": {
      const orderStr = op.order === "asc" ? "Bottom" : "Top";
      return `${orderStr} ${op.n} by ${op.by}${filterDesc}`;
    }
    case "time_trend": {
      const gran = op.granularity ? ` (${op.granularity})` : "";
      return `Trend of ${op.metric ?? "count"} by ${op.dateColumn}${gran}${filterDesc}`;
    }
    case "compare": {
      return `Compare ${op.column} (${op.values.join(" vs ")}) on ${op.metric ?? "count"}${filterDesc}`;
    }
    case "value_counts": {
      const limitStr = op.limit ? ` (top ${op.limit})` : "";
      return `Counts for ${op.column}${limitStr}${filterDesc}`;
    }
    case "correlation":
      return op.columns && op.columns.length > 0 ? `Correlation (${op.columns.join(", ")})` : "Correlation matrix";
    default:
      return "Query operation";
  }
}

/**
 * Combines multiple operations into a single compact chip string.
 * E.g. "Group by Region · Sum Revenue · Top 5"
 */
export function summarizeOps(ops: QueryOp[]): string {
  if (!ops || ops.length === 0) return "";
  return ops.map(summarizeOp).join("  |  ");
}

interface PlanTraceabilityChipProps {
  trace: PlanChipTrace;
}

export function PlanTraceabilityChip({ trace }: PlanTraceabilityChipProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!trace || !trace.ops || trace.ops.length === 0) return null;

  const handleCopyResults = () => {
    const raw = JSON.stringify(trace.results, null, 2);
    void navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasErrors = trace.results.some((r) => !!r.error);

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/5 text-xs transition-all">
      {/* Interactive Chip Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 select-none hover:bg-primary/10 transition-colors"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hasErrors ? (
            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
          )}

          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="font-semibold text-primary">Verified Calculation</span>
            <span className="text-subtle font-mono text-[11px]">·</span>
            <span className="truncate font-medium text-foreground">{trace.summary || summarizeOps(trace.ops)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {trace.versionLabel && (
            <span className="rounded-md border border-border bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {trace.versionLabel}
            </span>
          )}
          <span className="hidden sm:inline-flex rounded-md border border-border bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {trace.processing === "large" ? "DuckDB-WASM" : "Deterministic Engine"}
          </span>
          <button
            type="button"
            className="flex items-center text-muted-foreground hover:text-foreground"
            aria-label={open ? "Hide plan details" : "Inspect plan details"}
          >
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Inspection Panel */}
      {open && (
        <div className="border-t border-border/60 bg-background/60 p-3 space-y-3">
          {/* Metadata banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <Database className="size-3 text-primary" />
              <span>
                <strong className="text-foreground">{trace.datasetName}</strong>
                {trace.sheetName ? ` (${trace.sheetName})` : ""}
                {trace.versionLabel ? ` · ${trace.versionLabel}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Cpu className="size-3 text-primary" />
              <span>{trace.processing === "large" ? "DuckDB-WASM (In-Browser)" : "Fast In-Memory Engine"}</span>
            </div>
          </div>

          {/* Trace operations list */}
          <div className="space-y-3">
            {trace.results.map((res, idx) => {
              const matchingOp = trace.ops[idx];
              const title = matchingOp ? summarizeOp(matchingOp) : res.description;

              return (
                <div key={idx} className="rounded-lg border border-border/80 bg-card p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-semibold text-foreground text-[11px]">
                      Step {idx + 1}: {title}
                    </span>
                    <span className="font-mono text-[10px] uppercase text-subtle">{res.op}</span>
                  </div>

                  {res.error ? (
                    <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                      {res.error}
                    </div>
                  ) : res.value !== undefined ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-subtle text-[11px]">Result:</span>
                      <span className="font-mono text-sm font-bold text-primary">{String(res.value)}</span>
                    </div>
                  ) : null}

                  {res.columns && res.rows && res.rows.length > 0 && (
                    <div className="mt-1.5 max-h-48 overflow-auto rounded border border-border/50">
                      <table className="w-full border-collapse font-mono text-[10px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/60 text-left text-muted-foreground">
                            {res.columns.map((col, cIdx) => (
                              <th key={cIdx} className="px-2 py-1 font-semibold">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {res.rows.slice(0, 8).map((row, rIdx) => (
                            <tr key={rIdx} className="border-b border-border/30 hover:bg-muted/30">
                              {row.map((val, cIdx) => (
                                <td key={cIdx} className="px-2 py-0.5 text-foreground">
                                  {val !== null && val !== undefined ? String(val) : "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {res.rows.length > 8 && (
                        <div className="bg-muted/40 px-2 py-0.5 text-[10px] text-subtle text-center">
                          +{res.rows.length - 8} more rows computed in this step
                        </div>
                      )}
                    </div>
                  )}

                  {res.note && <p className="mt-1.5 text-[10px] italic text-muted-foreground">{res.note}</p>}
                </div>
              );
            })}
          </div>

          {/* Grounding guarantee footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Sliders className="size-3 text-emerald-500" />
              Grounded calculation: Numbers were computed by the data engine, not invented by AI.
            </span>
            <button
              type="button"
              onClick={handleCopyResults}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground hover:border-primary"
            >
              {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              {copied ? "Copied JSON" : "Copy Raw Results"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
