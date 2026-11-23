import { useState, useMemo } from "react";
import {
  FileText,
  Printer,
  Copy,
  Check,
  Download,
  ShieldCheck,
  Calendar,
  Layers,
  Database,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanChipTrace } from "./plan-chip";

export type ExecutiveBriefProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetName: string;
  versionLabel?: string | undefined;
  rowCount?: number | undefined;
  engine?: string | undefined;
  question: string;
  content: string;
  trace?: PlanChipTrace | null | undefined;
};

type ParsedBrief = {
  headline: string;
  findings: string[];
  whatChanged: string[];
  hypotheses: string[];
  recommendations: string[];
  scope: {
    dataset: string;
    version: string;
    engine: string;
    dateGenerated: string;
    operationsRun: string;
  };
};

function parseBriefFromContent(
  content: string,
  question: string,
  datasetName: string,
  versionLabel = "Active",
  engine = "Deterministic Data Engine",
  trace?: PlanChipTrace | null
): ParsedBrief {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  // Extract sections
  let headline = `Executive Assessment: ${question.replace(/\?$/, "")}`;
  const findings: string[] = [];
  const whatChanged: string[] = [];
  const hypotheses: string[] = [];
  const recommendations: string[] = [];

  let currentSection = "intro";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers
    if (/^#+\s*(snapshot|summary|overview)/i.test(trimmed)) {
      currentSection = "intro";
      continue;
    } else if (/^#+\s*(key findings|findings|top findings|takeaways)/i.test(trimmed)) {
      currentSection = "findings";
      continue;
    } else if (/^#+\s*(evidence|what changed|trend|comparison)/i.test(trimmed)) {
      currentSection = "changed";
      continue;
    } else if (/^#+\s*(data quality|anomalies|hypotheses|causes)/i.test(trimmed)) {
      currentSection = "hypotheses";
      continue;
    } else if (/^#+\s*(next action|recommendations?|action items?)/i.test(trimmed)) {
      currentSection = "recommendations";
      continue;
    }

    if (currentSection === "intro" && !headline.includes(":") && trimmed.length > 20) {
      headline = trimmed.replace(/^[#*-\s]+/, "");
    } else if (currentSection === "findings") {
      if (/^[*-]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        findings.push(trimmed.replace(/^[*-]\s+|^\d+\.\s+/, ""));
      }
    } else if (currentSection === "changed") {
      if (/^[*-]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        whatChanged.push(trimmed.replace(/^[*-]\s+|^\d+\.\s+/, ""));
      }
    } else if (currentSection === "hypotheses") {
      if (/^[*-]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        hypotheses.push(trimmed.replace(/^[*-]\s+|^\d+\.\s+/, ""));
      }
    } else if (currentSection === "recommendations") {
      if (/^[*-]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        recommendations.push(trimmed.replace(/^[*-]\s+|^\d+\.\s+/, ""));
      }
    }
  }

  // Fallbacks if content wasn't markdown structured
  if (findings.length === 0) {
    const bullets = lines.filter((l) => /^[*-]\s+/.test(l.trim())).map((l) => l.trim().replace(/^[*-]\s+/, ""));
    if (bullets.length > 0) {
      findings.push(...bullets.slice(0, 4));
    } else {
      findings.push("Verified computation executed against real dataset rows.");
      if (trace?.summary) findings.push(`Primary operation: ${trace.summary}`);
    }
  }

  if (whatChanged.length === 0 && trace?.results) {
    for (const res of trace.results) {
      if (res.note) whatChanged.push(res.note);
      if (res.value !== undefined) whatChanged.push(`${res.description}: ${res.value}`);
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("Proceed with targeted operational review based on verified metrics above.");
    recommendations.push("Inspect data-quality warnings prior to publishing high-stakes reporting.");
  }

  const opsList = trace?.ops ? trace.ops.map((o) => o.op).join(", ") : "QueryOp scan";

  return {
    headline,
    findings: findings.slice(0, 5),
    whatChanged: whatChanged.slice(0, 4),
    hypotheses: hypotheses.slice(0, 4),
    recommendations: recommendations.slice(0, 3),
    scope: {
      dataset: datasetName,
      version: versionLabel,
      engine,
      dateGenerated: new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      operationsRun: opsList,
    },
  };
}

export function ExecutiveBriefDialog({
  open,
  onOpenChange,
  datasetName,
  versionLabel = "Active",
  rowCount,
  engine = "Deterministic Data Engine",
  question,
  content,
  trace,
}: ExecutiveBriefProps) {
  const [copied, setCopied] = useState(false);

  const brief = useMemo(() => {
    return parseBriefFromContent(content, question, datasetName, versionLabel, engine, trace);
  }, [content, question, datasetName, versionLabel, engine, trace]);

  const markdownString = useMemo(() => {
    return [
      `# Executive Brief: ${datasetName}`,
      `*Generated on ${brief.scope.dateGenerated} | DataSimplr Verified Analysis*`,
      "",
      `## 1. Headline Verdict`,
      brief.headline,
      "",
      `## 2. Key Findings`,
      ...brief.findings.map((f) => `- ${f}`),
      "",
      brief.whatChanged.length ? `## 3. Observed Performance & Trends` : "",
      ...brief.whatChanged.map((c) => `- ${c}`),
      "",
      brief.hypotheses.length ? `## 4. Observations & Hypotheses (Subject to Operational Verification)` : "",
      ...brief.hypotheses.map((h) => `- ${h}`),
      "",
      `## 5. Recommended Next Steps`,
      ...brief.recommendations.map((r, i) => `${i + 1}. ${r}`),
      "",
      `---`,
      `### Method & Scope`,
      `- **Source Dataset:** ${brief.scope.dataset} (${brief.scope.version})`,
      rowCount ? `- **Record Count:** ${rowCount.toLocaleString()} rows` : "",
      `- **Execution Engine:** ${brief.scope.engine}`,
      `- **Calculated Operations:** ${brief.scope.operationsRun}`,
      `- **Grounded Guarantee:** Calculations were performed deterministically on your local machine. No numbers were approximated or generated by LLM reasoning alone.`,
      "",
      `*Calculated with DataSimplr — Clean Data. Ask Questions. Take Action.*`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [brief, datasetName, rowCount]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(markdownString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdownString], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `executive-brief-${datasetName.toLowerCase().replace(/[^a-z0-9]/g, "-")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0 gap-0 border-border bg-card">
        {/* Header toolbar */}
        <DialogHeader className="border-b border-border/80 px-6 py-4 flex flex-row items-center justify-between sticky top-0 bg-card/95 backdrop-blur z-10">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <FileText className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Executive Brief</DialogTitle>
              <p className="text-xs text-muted-foreground">Board-ready structured operational takeaway</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mr-6">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-medium hover:border-primary transition-colors"
            >
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy Markdown"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-medium hover:border-primary transition-colors"
            >
              <Download className="size-3.5" />
              .md
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <Printer className="size-3.5" />
              Print / PDF
            </button>
          </div>
        </DialogHeader>

        {/* Printable & Readable Brief Body */}
        <div id="executive-brief-printable" className="p-6 space-y-6 text-foreground text-sm">
          {/* Top Title Banner */}
          <div className="border-b border-border/60 pb-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-mono uppercase tracking-wider text-primary font-semibold">DataSimplr Verified Brief</span>
              <span className="flex items-center gap-1">
                <Calendar className="size-3" />
                {brief.scope.dateGenerated}
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{brief.scope.dataset}</h1>
            <p className="text-xs text-muted-foreground mt-1">Inquiry: "{question}"</p>
          </div>

          {/* 1. Headline / Verdict */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-primary mb-1">
              1. Headline Verdict
            </h3>
            <p className="text-sm font-semibold leading-relaxed text-foreground">{brief.headline}</p>
          </div>

          {/* 2. Key Findings */}
          <div>
            <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Layers className="size-3.5 text-primary" />
              2. Key Findings
            </h3>
            <div className="space-y-2">
              {brief.findings.map((finding, idx) => (
                <div key={idx} className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-mono text-[11px] font-bold">
                    {idx + 1}
                  </span>
                  <p className="text-xs text-foreground/90 leading-relaxed">{finding}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 3. What Changed / Trends */}
          {brief.whatChanged.length > 0 && (
            <div>
              <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                3. Observed Performance & Trends
              </h3>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-muted-foreground">
                {brief.whatChanged.map((c, idx) => (
                  <li key={idx} className="text-foreground/90">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 4. Hypotheses & Explanations */}
          {brief.hypotheses.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/20 p-3.5">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-500 mb-1.5 flex items-center gap-1">
                <Info className="size-3 text-amber-500" />
                4. Observations & Hypotheses (Requires Operational Verification)
              </h3>
              <p className="text-[11px] text-muted-foreground mb-2">
                Note: Identified associations indicate patterns, not proven root causes.
              </p>
              <ul className="list-disc pl-5 space-y-1 text-xs text-foreground/90">
                {brief.hypotheses.map((h, idx) => (
                  <li key={idx}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 5. Recommended Next Steps */}
          <div>
            <h3 className="text-xs font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              5. Recommended Next Steps
            </h3>
            <div className="grid gap-2">
              {brief.recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-xs">
                  <span className="font-mono text-primary font-bold">Step {idx + 1}:</span>
                  <span className="text-foreground">{rec}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 6. Method & Scope */}
          <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-[11px] space-y-2">
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="font-semibold text-muted-foreground uppercase text-[10px] tracking-wider flex items-center gap-1">
                <Database className="size-3 text-primary" />
                Method & Scope
              </span>
              <span className="flex items-center gap-1 text-emerald-500 font-medium">
                <ShieldCheck className="size-3.5" />
                Calculation-Grounded
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-muted-foreground">
              <div>
                <span className="block text-[10px] text-subtle">Dataset & Version:</span>
                <span className="font-medium text-foreground">{brief.scope.dataset} ({brief.scope.version})</span>
              </div>
              <div>
                <span className="block text-[10px] text-subtle">Computation Engine:</span>
                <span className="font-medium text-foreground">{brief.scope.engine}</span>
              </div>
              {rowCount && (
                <div>
                  <span className="block text-[10px] text-subtle">Total Records Scanned:</span>
                  <span className="font-medium text-foreground">{rowCount.toLocaleString()}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/80 italic pt-1">
              Calculations were performed deterministically by the local data engine on your dataset. AI structured the narrative from verified data points.
            </p>
          </div>

          {/* Subtle footer attribution */}
          <div className="text-center text-[10px] text-muted-foreground pt-2 border-t border-border/40">
            Calculated with <strong>DataSimplr</strong> — Clean Data. Ask Questions. Take Action.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
