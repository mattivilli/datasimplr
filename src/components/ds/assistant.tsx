import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  ClipboardPaste,
  FileSpreadsheet,
  Lightbulb,
  LineChart,
  Send,
  Sigma,
  Table2,
  Upload,
  Wand2,
} from "lucide-react";

type Tool = {
  icon: typeof BarChart3;
  label: string;
  detail: string;
};

type Bar = { label: string; value: number; negative?: boolean };

type Answer = {
  headline: string;
  tools: Tool[];
  bullets: string[];
  bars?: Bar[];
  table?: { head: string[]; rows: string[][] };
  suggestions: string[];
};

const dataset = {
  name: "sales_q3_2026.xlsx",
  rows: "12,480 rows",
  cols: "18 columns",
};

const conversations: { q: string; a: Answer }[] = [
  {
    q: "What changed this quarter?",
    a: {
      headline: "Revenue is up 8.4%, but the growth is concentrated in two regions.",
      tools: [
        { icon: Sigma, label: "Aggregate", detail: "Grouped revenue by region × month" },
        { icon: LineChart, label: "Trend fit", detail: "Compared Q3 against Q2 baseline" },
      ],
      bullets: [
        "North and West drove 91% of the quarterly gain.",
        "South declined for the third month in a row (-14%).",
        "Average order value rose from $312 to $338.",
      ],
      bars: [
        { label: "North", value: 82 },
        { label: "West", value: 68 },
        { label: "East", value: 34 },
        { label: "South", value: 18, negative: true },
      ],
      suggestions: ["Why is South declining?", "Which products are at risk?"],
    },
  },
  {
    q: "Where are the anomalies?",
    a: {
      headline: "Four outliers fall outside 2.5 standard deviations.",
      tools: [
        { icon: AlertTriangle, label: "Outlier scan", detail: "z-score across 12,480 rows" },
        { icon: Table2, label: "Row lookup", detail: "Returned matching transactions" },
      ],
      bullets: [
        "Two refunds exceed the original invoice amount.",
        "One account was billed twice on the same date.",
      ],
      table: {
        head: ["Record", "Field", "Expected", "Found"],
        rows: [
          ["TX-4821", "Refund", "$1,200", "$1,880"],
          ["TX-5093", "Refund", "$640", "$910"],
          ["AC-118", "Invoices", "1", "2"],
          ["TX-6640", "Units", "≤ 500", "7,400"],
        ],
      },
      suggestions: ["Estimate the financial impact", "Draft a summary for finance"],
    },
  },
  {
    q: "What should I do next?",
    a: {
      headline: "Three recommended actions, ranked by expected impact.",
      tools: [
        { icon: Brain, label: "Reasoning", detail: "Weighted impact vs effort" },
        { icon: Lightbulb, label: "Recommend", detail: "Generated prioritized actions" },
      ],
      bullets: [
        "Review South-region pricing — recovering half the gap adds ~$96K.",
        "Reduce top-10 customer concentration (58% of revenue today).",
        "Add a refund validation rule to stop duplicate credits.",
      ],
      bars: [
        { label: "Pricing", value: 88 },
        { label: "Concentration", value: 62 },
        { label: "Controls", value: 41 },
      ],
      suggestions: ["Build a one-page report", "Forecast next quarter"],
    },
  },
];

const tabs = [
  { key: "upload", label: "Upload file", icon: Upload },
  { key: "paste", label: "Paste data", icon: ClipboardPaste },
] as const;

function ToolChip({ tool, active }: { tool: Tool; active: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all ${
        active ? "border-primary bg-accent" : "border-border bg-muted"
      }`}
    >
      <tool.icon className={`size-3.5 ${active ? "text-primary" : "text-subtle"}`} />
      <div className="leading-tight">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-foreground">
          {tool.label}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{tool.detail}</p>
      </div>
    </div>
  );
}

function AnswerCard({ answer, onAsk }: { answer: Answer; onAsk: (q: string) => void }) {
  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap gap-2">
        {answer.tools.map((t) => (
          <ToolChip key={t.label} tool={t} active />
        ))}
      </div>

      <p className="font-display text-base font-semibold sm:text-lg">{answer.headline}</p>

      <ul className="space-y-2">
        {answer.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            {b}
          </li>
        ))}
      </ul>

      {answer.bars && (
        <div className="rounded-xl border border-border bg-muted p-4">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
            <BarChart3 className="size-3.5 text-primary" /> Generated chart
          </div>
          <div className="mt-4 space-y-2.5">
            {answer.bars.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{b.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${b.value}%`,
                      background: b.negative ? "var(--destructive)" : "var(--primary)",
                    }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right font-mono text-[11px] text-subtle">
                  {b.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {answer.table && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted">
              <tr>
                {answer.table.head.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answer.table.rows.map((r) => (
                <tr key={r[0]} className="border-t border-border">
                  {r.map((c, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2.5 ${
                        i === 0 ? "font-mono text-subtle" : "text-muted-foreground"
                      }`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {answer.suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onAsk(s)}
            className="flex items-center gap-2 rounded-full border border-border bg-muted px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Wand2 className="size-3 text-primary" />
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Assistant() {
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("upload");
  const [step, setStep] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const ask = (index: number) => {
    if (timer.current) clearTimeout(timer.current);
    setThinking(true);
    setStep(index);
    timer.current = setTimeout(() => setThinking(false), 1100);
  };

  const askText = (q: string) => {
    const match = conversations.findIndex((c) => c.q === q);
    ask(match >= 0 ? match : (step + 1) % conversations.length);
    setInput("");
  };

  const current = conversations[step] ?? conversations[0]!;

  return (
    <section id="assistant" className="relative border-t border-border py-24">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="eyebrow">AI assistant</span>
          <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
            An Analyst That Reads Your Files.
            <br />
            <span className="text-brand">And Tells You What To Do.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Upload a file or paste a few rows, then ask in plain language. The assistant picks the
            right analysis tools, shows its work, and recommends next steps.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-[340px_1fr]">
          {/* Data panel */}
          <div className="panel p-5">
            <div className="flex gap-1.5 rounded-xl border border-border bg-muted p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    tab === t.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "upload" ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-muted px-5 py-8 text-center">
                <Upload className="mx-auto size-5 text-primary" />
                <p className="mt-3 text-sm font-semibold">Drop CSV, Excel or PDF</p>
                <p className="mt-1 text-xs text-muted-foreground">Up to 20 MB per file</p>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-muted p-3">
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
{`region,month,revenue
North,Jul,412300
South,Jul,198400
North,Aug,448900
South,Aug,171200`}
                </pre>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-border bg-accent px-4 py-3">
              <div className="flex items-center gap-2.5">
                <FileSpreadsheet className="size-4 text-primary" />
                <div className="leading-tight">
                  <p className="text-xs font-semibold text-foreground">{dataset.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] tracking-widest text-subtle">
                    {dataset.rows} · {dataset.cols}
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
              Try asking
            </p>
            <div className="mt-3 space-y-2">
              {conversations.map((c, i) => (
                <button
                  key={c.q}
                  onClick={() => ask(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs transition-colors ${
                    step === i
                      ? "border-primary bg-accent text-foreground"
                      : "border-border bg-muted text-muted-foreground hover:border-primary"
                  }`}
                >
                  {c.q}
                  <ArrowRight className="size-3.5 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          </div>

          {/* Chat panel */}
          <div className="panel flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-muted px-5 py-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                <span className="size-1.5 rounded-full bg-primary" /> DataSimplr assistant
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Live demo
              </span>
            </div>

            <div className="flex-1 space-y-5 p-5 sm:p-6">
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {current.q}
                </p>
              </div>

              {thinking ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Brain className="size-4 animate-pulse text-primary" />
                    Reading {dataset.name}, choosing tools…
                  </div>
                  <div className="h-2 w-2/3 animate-pulse rounded-full bg-border" />
                  <div className="h-2 w-1/2 animate-pulse rounded-full bg-border" />
                </div>
              ) : (
                <AnswerCard answer={current.a} onAsk={askText} />
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                askText(input.trim());
              }}
              className="flex items-center gap-2 border-t border-border bg-muted px-4 py-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything about your data…"
                className="flex-1 bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-subtle"
              />
              <button
                type="submit"
                aria-label="Send"
                className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                <Send className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
