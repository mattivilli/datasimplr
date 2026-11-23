import { useMemo } from "react";
import { Sparkles, ArrowRight, ShieldAlert, CheckCircle2, TrendingUp, BarChart2 } from "lucide-react";

export type ColumnInfo = {
  name: string;
  type: string;
  sample?: (string | number)[];
};

export interface FirstReadCoachProps {
  datasetName: string;
  rowCount: number;
  columns: ColumnInfo[];
  qualityScore?: number | null | undefined;
  issuesCount?: number | undefined;
  versionLabel?: string | undefined;
  onSelectQuestion: (question: string) => void;
  className?: string | undefined;
}

export function FirstReadCoach({
  datasetName,
  rowCount,
  columns,
  qualityScore,
  issuesCount = 0,
  versionLabel,
  onSelectQuestion,
  className = "",
}: FirstReadCoachProps) {
  const analysis = useMemo(() => {
    const colNames = columns.map((c) => c.name.toLowerCase());

    // Detect key column types
    const dateCol = columns.find((c) =>
      c.type === "date" ||
      /(date|time|timestamp|created_at|period|month|year|day)/i.test(c.name)
    )?.name;

    const metricCols = columns.filter((c) =>
      c.type === "number" ||
      c.type === "integer" ||
      c.type === "numeric" ||
      /(revenue|amount|sales|price|cost|profit|total|qty|quantity|count|score|value|balance|rate)/i.test(c.name)
    );

    const categoryCols = columns.filter((c) =>
      c.type === "string" ||
      c.type === "text" ||
      c.type === "category" ||
      (!metricCols.includes(c) && !/(id|uuid|hash|key|index|code)/i.test(c.name))
    );

    const primaryMetric =
      metricCols.find((c) => /(revenue|sales|amount|total|price|profit)/i.test(c.name))?.name ??
      metricCols[0]?.name;

    const secondaryMetric = metricCols.find((c) => c.name !== primaryMetric)?.name;

    const primaryCategory =
      categoryCols.find((c) => /(category|product|item|region|country|city|status|segment|department|channel|brand)/i.test(c.name))?.name ??
      categoryCols[0]?.name;

    // Detect likely grain / domain
    let domain = "business records";
    if (colNames.some((c) => /(order|invoice|transaction|sale|cart)/i.test(c))) {
      domain = "order & sales transaction data";
    } else if (colNames.some((c) => /(customer|client|subscriber|user|account)/i.test(c))) {
      domain = "customer / account performance data";
    } else if (colNames.some((c) => /(defect|incident|ticket|error|log|repair|failure)/i.test(c))) {
      domain = "operational quality & tracking records";
    } else if (colNames.some((c) => /(campaign|ad|click|impression|conversion|spend)/i.test(c))) {
      domain = "marketing campaign & performance data";
    } else if (colNames.some((c) => /(delivery|shipment|warehouse|dispatch|carrier|transit)/i.test(c))) {
      domain = "logistics & dispatch records";
    }

    // Build concise 2-sentence summary
    const formattedRows = rowCount.toLocaleString();
    const formattedCols = columns.length;
    const summarySentences: string[] = [];

    summarySentences.push(
      `This appears to be ${domain} containing ${formattedRows} records across ${formattedCols} columns.`
    );

    if (qualityScore !== undefined && qualityScore !== null) {
      if (issuesCount > 0) {
        summarySentences.push(
          `Data quality score is ${qualityScore}/100 with ${issuesCount} ${issuesCount === 1 ? "issue" : "issues"} flagged for review.`
        );
      } else {
        summarySentences.push(
          `Data quality score is ${qualityScore}/100 with clean, consistent column formatting.`
        );
      }
    } else if (dateCol) {
      summarySentences.push(`Time-series timeline is indexed along the "${dateCol}" column.`);
    }

    // Curate 3 high-impact questions mapped to deterministic operations
    const questions: { text: string; icon: typeof TrendingUp; badge: string }[] = [];

    // 1. Group / Aggregation Question
    if (primaryCategory && primaryMetric) {
      questions.push({
        text: `Which ${primaryCategory} generated the highest ${primaryMetric}?`,
        icon: BarChart2,
        badge: "Breakdown",
      });
    } else if (primaryMetric) {
      questions.push({
        text: `What are the summary statistics and distribution of ${primaryMetric}?`,
        icon: BarChart2,
        badge: "Distribution",
      });
    } else {
      questions.push({
        text: "Provide a comprehensive snapshot of this dataset.",
        icon: BarChart2,
        badge: "Overview",
      });
    }

    // 2. Trend or Secondary Breakdown Question
    if (dateCol && primaryMetric) {
      questions.push({
        text: `How did ${primaryMetric} trend over time by ${dateCol}?`,
        icon: TrendingUp,
        badge: "Time Trend",
      });
    } else if (primaryCategory && secondaryMetric) {
      questions.push({
        text: `Compare ${secondaryMetric} across top ${primaryCategory}.`,
        icon: TrendingUp,
        badge: "Comparison",
      });
    } else if (metricCols.length >= 2) {
      questions.push({
        text: `Find correlations among numeric metrics like ${metricCols.slice(0, 2).map((m) => m.name).join(" and ")}.`,
        icon: TrendingUp,
        badge: "Correlation",
      });
    } else {
      questions.push({
        text: "What are the key trends and patterns in these records?",
        icon: TrendingUp,
        badge: "Trends",
      });
    }

    // 3. Quality / Action Question
    if (issuesCount > 0) {
      questions.push({
        text: "Which data-quality issues should be cleaned first?",
        icon: ShieldAlert,
        badge: "Quality",
      });
    } else if (primaryMetric) {
      questions.push({
        text: `Are there any unusual transactions or outliers in ${primaryMetric}?`,
        icon: CheckCircle2,
        badge: "Anomalies",
      });
    } else {
      questions.push({
        text: "Which records or columns need review or cleaning?",
        icon: CheckCircle2,
        badge: "Quality",
      });
    }

    return {
      summary: summarySentences.join(" "),
      questions: questions.slice(0, 3),
    };
  }, [columns, rowCount, qualityScore, issuesCount]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/10 via-card to-card p-5 text-left shadow-md ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
              First-Read Coach
              {versionLabel && (
                <span className="text-[10px] font-mono font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {versionLabel}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground">Automated profiling & suggested inquiries</p>
          </div>
        </div>

        <span className="hidden sm:inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
          Calculation-Grounded
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-foreground/90 font-medium">{analysis.summary}</p>

      <div className="mt-4">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Suggested questions for this dataset:
        </p>

        <div className="grid gap-2 sm:grid-cols-1">
          {analysis.questions.map((q, idx) => {
            const Icon = q.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectQuestion(q.text)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card/80 p-3 text-left transition-all hover:border-primary hover:bg-accent/60 hover:shadow-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="size-4 shrink-0 text-primary transition-transform group-hover:scale-110" />
                  <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {q.text}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                    {q.badge}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
