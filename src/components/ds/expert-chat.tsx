import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Braces,
  CheckCircle2,
  Cpu,
  Gauge,
  Layers,
  MessageSquareText,
  Network,
  Send,
  Sparkles,
} from "lucide-react";

type Block =
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: string[] }
  | { kind: "code"; code: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "note"; text: string };

type Answer = {
  topic: string;
  headline: string;
  trace: string[];
  blocks: Block[];
  confidence: number;
  tags: string[];
  followups: string[];
};

type Topic = {
  key: string;
  label: string;
  icon: typeof Cpu;
  question: string;
  keywords: string[];
  answer: Answer;
};

const topics: Topic[] = [
  {
    key: "rag",
    label: "RAG & LLMs",
    icon: Network,
    question: "Why does my RAG answer ignore half of the retrieved chunks?",
    keywords: ["rag", "retrieval", "chunk", "embedding", "vector", "hallucin", "context"],
    answer: {
      topic: "RAG & LLMs",
      headline: "Top-k similarity is ranking your prompt, and similarity is not relevance.",
      trace: ["Diagnosing retrieval pipeline", "Comparing against known failure modes"],
      blocks: [
        {
          kind: "para",
          text: "With fixed 512-token windows you retrieve 20 chunks, and roughly half are near-duplicates of each other. They crowd out the one chunk that actually contains the answer, so the model attends to the wrong context and you read it as a hallucination.",
        },
        {
          kind: "steps",
          items: [
            "Hybrid retrieval: BM25 + dense vectors, weighted, so exact terms survive",
            "Rerank 40 candidates down to 5 with a cross-encoder",
            "Collapse child hits back to parent chunks so tables and procedures stay whole",
            "Require span-level citations, and refuse when the best score falls below threshold",
          ],
        },
        {
          kind: "code",
          code: "retriever = HybridRetriever(\n  dense=faiss_index,\n  sparse=bm25(k1=1.4, b=0.75),\n  weights=(0.6, 0.4),\n)\n\ncandidates = retriever.search(query, k=40)\nevidence   = rerank(cross_encoder, query, candidates, top=5)\n\nif evidence[0].score < 0.35:\n    return Refuse(reason=\"no grounded passage\")",
        },
        {
          kind: "table",
          head: ["Stage", "Before", "After"],
          rows: [
            ["Answer recall", "0.61", "0.88"],
            ["Citation precision", "0.72", "0.94"],
            ["Refusals (correct)", "9%", "23%"],
          ],
        },
        {
          kind: "note",
          text: "Build a 30-question gold set first. Without it you are tuning blind and every change looks like an improvement.",
        },
      ],
      confidence: 92,
      tags: ["Retrieval", "Reranking", "Evaluation"],
      followups: ["Which reranker is cheap enough for production?", "How do I chunk tables without breaking them?"],
    },
  },
  {
    key: "ml",
    label: "Model training",
    icon: Cpu,
    question: "Validation accuracy is 96% but production is a mess. What am I missing?",
    keywords: ["overfit", "validation", "accuracy", "leakage", "drift", "deploy", "train"],
    answer: {
      topic: "Model training",
      headline: "A 96% validation score with a broken production model is almost always leakage plus shift.",
      trace: ["Checking split design", "Auditing feature timing"],
      blocks: [
        {
          kind: "para",
          text: "Random splits leak when your rows share a customer, a session, or a date. The model memorises identity instead of learning signal, and the first week of traffic exposes it.",
        },
        {
          kind: "list",
          items: [
            "Split by time and by entity, never by random row",
            "Confirm every feature was knowable at prediction time, not at label time",
            "Re-check class balance — production rarely matches your sampling",
            "Switch the metric to the one money moves on, not accuracy",
          ],
        },
        {
          kind: "table",
          head: ["Signal", "Training", "Production"],
          rows: [
            ["Positive rate", "31%", "4.8%"],
            ["Feature nulls", "0.4%", "11.2%"],
            ["AUC", "0.97", "0.68"],
          ],
        },
        {
          kind: "note",
          text: "Train on yesterday, validate on today, deploy on tomorrow. Then monitor the score distribution, not just the metric.",
        },
      ],
      confidence: 89,
      tags: ["Validation", "Leakage", "Monitoring"],
      followups: ["How do I detect drift before users notice?", "What should my baseline model be?"],
    },
  },
  {
    key: "eval",
    label: "LLM evaluation",
    icon: Gauge,
    question: "How do I evaluate an LLM app when I have no labelled dataset?",
    keywords: ["eval", "evaluate", "judge", "benchmark", "dataset", "rubric", "test"],
    answer: {
      topic: "LLM evaluation",
      headline: "You do not need a dataset, you need 50 real transcripts and a written rubric.",
      trace: ["Designing a rubric", "Calibrating the judge"],
      blocks: [
        {
          kind: "steps",
          items: [
            "Pull 50 real production exchanges, sampled across intent, not the easy ones",
            "Write a 4-line rubric: grounded, complete, safe, on-brand",
            "Score 20 by hand, then have the judge score all 50 and compare",
            "Keep the judge only where it agrees with you above 85%",
            "Run the suite on every prompt or model change in CI",
          ],
        },
        {
          kind: "code",
          code: "RUBRIC = \"\"\"\nScore 1-4 per axis, then the minimum is the grade.\n  grounded  - claims traceable to retrieved evidence\n  complete  - every part of the request answered\n  safe      - no invented policy, price or promise\n  brand     - tone and format match the style guide\n\"\"\"",
        },
        {
          kind: "note",
          text: "A judge that agrees with you 85% of the time is a proxy, and proxies drift. Re-label a fresh 20 every month.",
        },
      ],
      confidence: 90,
      tags: ["Rubrics", "LLM-as-judge", "CI"],
      followups: ["How small can a regression suite be?", "Judge on the same model family — fine or biased?"],
    },
  },
  {
    key: "forecast",
    label: "Forecasting",
    icon: Layers,
    question: "ARIMA, Prophet, or gradient boosting for 18 months of monthly sales?",
    keywords: ["forecast", "arima", "prophet", "timeseries", "time series", "seasonal", "boosting"],
    answer: {
      topic: "Forecasting",
      headline: "With 18 monthly points, complexity buys you nothing you can verify.",
      trace: ["Comparing estimator data needs", "Checking seasonality depth"],
      blocks: [
        {
          kind: "para",
          text: "You have one and a half annual cycles. That is not enough to separate trend, seasonality, and promotion lift, so a flexible model will quietly fit noise and call it a pattern.",
        },
        {
          kind: "table",
          head: ["Method", "Needs", "Verdict here"],
          rows: [
            ["Seasonal naive + drift", "12 points", "Start here"],
            ["ETS / ARIMA", "24+ points", "Only with auto-selection"],
            ["Prophet", "2+ cycles", "Holiday effects if you have them"],
            ["Gradient boosting", "100s of series", "Later, once you have a panel"],
          ],
        },
        {
          kind: "list",
          items: [
            "Benchmark against seasonal naive with drift; beat it or ship nothing",
            "Forecast at the level decisions are made, then reconcile top-down",
            "Report intervals, not a single line — 18 points means wide intervals",
          ],
        },
        {
          kind: "note",
          text: "The forecast is the easy part. Getting the causal drivers (price, stock, promo) into a shared calendar is where the accuracy lives.",
        },
      ],
      confidence: 87,
      tags: ["Baselines", "Hierarchy", "Intervals"],
      followups: ["How do I reconcile SKU and regional forecasts?", "Which backtest window should I use?"],
    },
  },
  {
    key: "sql",
    label: "SQL & pipelines",
    icon: Braces,
    question: "Our dashboard times out on a 40M-row table. Where do I start?",
    keywords: ["sql", "query", "slow", "timeout", "index", "warehouse", "pipeline", "performance"],
    answer: {
      topic: "SQL & pipelines",
      headline: "Before touching indexes, read the plan — the table is probably being scanned whole.",
      trace: ["Reading the query plan", "Ranking fixes by cost"],
      blocks: [
        {
          kind: "steps",
          items: [
            "Run the plan and look for full scans and shuffle-heavy joins",
            "Partition or cluster by the column every filter already uses",
            "Pre-aggregate to the grain the dashboard actually renders",
            "Cache the aggregate layer, not the raw query",
          ],
        },
        {
          kind: "code",
          code: "EXPLAIN (ANALYZE, BUFFERS)\nSELECT region, date_trunc('day', ts) AS d, sum(revenue)\nFROM   events\nWHERE  ts >= now() - interval '90 days'\nGROUP  BY 1, 2;\n\n-- full scan on 40M rows? cluster by ts, then:\nCREATE MATERIALIZED VIEW mv_daily AS\nSELECT region, date_trunc('day', ts) d, sum(revenue) r\nFROM events GROUP BY 1, 2;\n\nREFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily;",
        },
        {
          kind: "table",
          head: ["Fix", "Effort", "Latency"],
          rows: [
            ["Prune partitions", "Low", "-70%"],
            ["Cluster by filter key", "Low", "-45%"],
            ["Materialise day grain", "Med", "-95%"],
          ],
        },
        {
          kind: "note",
          text: "Dashboards read the same three queries all day. Serving those from a small pre-aggregated table beats any index tuning.",
        },
      ],
      confidence: 91,
      tags: ["Query plans", "Partitioning", "Materialised views"],
      followups: ["When does a materialised view stop being enough?", "How should I test a pipeline change safely?"],
    },
  },
];

const general: Answer = {
  topic: "General",
  headline: "Ask it the way you would ask a senior colleague who happens to know the whole stack.",
  trace: ["Matching your question to a domain"],
  blocks: [
    {
      kind: "para",
      text: "The expert chat covers data analysis, statistics, model training, evaluation, retrieval systems, MLOps, and SQL or pipeline work. It explains the trade-off, shows the code, and tells you when the honest answer is \"it depends\".",
    },
    {
      kind: "list",
      items: [
        "Grounded reasoning, not a generic blog answer",
        "Concrete code and config you can paste",
        "It states what it would need to check before committing",
      ],
    },
  ],
  confidence: 78,
  tags: ["Data science", "AI / ML", "RAG", "MLOps"],
  followups: topics.slice(0, 2).map((t) => t.question),
};

function Trace({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 animate-pulse text-primary" />
        {lines[0] ?? "Thinking"}…
      </div>
      <div className="space-y-2">
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-border" />
        <div className="h-2 w-1/2 animate-pulse rounded-full bg-border" />
        <div className="h-2 w-3/4 animate-pulse rounded-full bg-border" />
      </div>
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.kind === "para") {
          return (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">
              {b.text}
            </p>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="space-y-2">
              {b.items.map((it) => (
                <li key={it} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  {it}
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === "steps") {
          return (
            <ol key={i} className="space-y-2.5">
              {b.items.map((it, n) => (
                <li key={it} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono text-[10px] text-primary">
                    {n + 1}
                  </span>
                  {it}
                </li>
              ))}
            </ol>
          );
        }
        if (b.kind === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl border border-border bg-muted p-4 font-mono text-[11px] leading-relaxed text-foreground"
            >
              {b.code}
            </pre>
          );
        }
        if (b.kind === "table") {
          return (
            <div key={i} className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted">
                  <tr>
                    {b.head.map((h) => (
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
                  {b.rows.map((r) => (
                    <tr key={r.join("|")} className="border-t border-border">
                      {r.map((c, j) => (
                        <td
                          key={j}
                          className={`px-3 py-2.5 ${
                            j === 0 ? "font-mono text-subtle" : "text-muted-foreground"
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
          );
        }
        return (
          <div key={i} className="flex items-start gap-2.5 rounded-xl border border-border bg-accent px-4 py-3">
            <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">{b.text}</p>
          </div>
        );
      })}
    </div>
  );
}

export function ExpertChat() {
  const [active, setActive] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const open = (index: number) => {
    if (timer.current) clearTimeout(timer.current);
    setActive(index);
    setThinking(true);
    timer.current = setTimeout(() => setThinking(false), 950);
  };

  const submit = (text: string) => {
    const q = text.trim().toLowerCase();
    setInput("");
    if (!q) return;
    let best = -1;
    let bestScore = 0;
    topics.forEach((t, i) => {
      const score = t.keywords.reduce((s, k) => (q.includes(k) ? s + 1 : s), 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) open(best);
    else {
      if (timer.current) clearTimeout(timer.current);
      setThinking(true);
      timer.current = setTimeout(() => setThinking(false), 950);
    }
  };

  const current = topics[active] ?? topics[0]!;
  const answer = current.answer;

  return (
    <section id="expert-chat" className="relative border-t border-border py-24">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="eyebrow">Expert AI chat</span>
          <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
            Not Only Your Data.
            <br />
            <span className="text-brand">Every Hard Question Too.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            A second kind of assistant: an expert chat for data science, machine learning, RAG,
            evaluation, MLOps and SQL. It reasons, shows code, and says what it would verify first.
          </p>
        </div>

        <div className="mt-14 panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted px-4 py-3">
            {topics.map((t, i) => (
              <button
                key={t.key}
                onClick={() => open(i)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active === i && !thinking
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid gap-0 lg:grid-cols-[1fr_280px]">
            <div className="space-y-6 p-5 sm:p-7">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {current.question}
                </p>
              </div>

              {thinking ? (
                <Trace lines={current.answer.trace} />
              ) : (
                <div className="animate-rise space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
                      <MessageSquareText className="size-3 text-primary" />
                      {answer.topic}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
                      <Gauge className="size-3 text-primary" />
                      {answer.confidence}% confidence
                    </span>
                  </div>

                  <p className="font-display text-base font-semibold sm:text-lg">{answer.headline}</p>

                  <Blocks blocks={answer.blocks} />

                  <div className="flex flex-wrap gap-2 pt-1">
                    {answer.followups.map((f) => (
                      <button
                        key={f}
                        onClick={() => submit(f)}
                        className="flex items-center gap-2 rounded-full border border-border bg-muted px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                      >
                        <ArrowRight className="size-3 text-primary" />
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="border-t border-border bg-muted p-5 lg:border-l lg:border-t-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                What it answers
              </p>
              <ul className="mt-4 space-y-3">
                {general.blocks
                  .filter((b): b is Extract<Block, { kind: "list" }> => b.kind === "list")
                  .flatMap((b) => b.items)
                  .map((it) => (
                    <li key={it} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      {it}
                    </li>
                  ))}
              </ul>

              <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Domains
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Data science", "AI / ML", "RAG", "MLOps", "Statistics", "SQL", "Cloud"].map((d) => (
                  <span
                    key={d}
                    className="rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[10px] tracking-widest text-subtle"
                  >
                    {d.toUpperCase()}
                  </span>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-border bg-card p-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No file needed. Ask a concept, a bug, an architecture call, or "review this
                  approach" — it answers like a senior practitioner.
                </p>
              </div>
            </aside>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
            className="flex items-center gap-2 border-t border-border bg-muted px-4 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask an expert question — RAG, model drift, forecasting, SQL…"
              className="flex-1 bg-transparent px-1 py-2 text-sm text-foreground outline-none placeholder:text-subtle"
            />
            <button
              type="submit"
              aria-label="Ask"
              className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
