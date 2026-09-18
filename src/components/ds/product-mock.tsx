import { FileSpreadsheet, Send, Sparkles, TrendingDown } from "lucide-react";

const declines = [
  { name: "Product A", value: "18.4%", bar: 92 },
  { name: "Product B", value: "12.7%", bar: 64 },
  { name: "Product C", value: "9.3%", bar: 47 },
];

const bars = [38, 52, 44, 61, 55, 72, 66, 81, 74, 58, 69, 88];

export function ProductMock() {
  return (
    <div
      className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border bg-card"
      style={{ boxShadow: "0 40px 100px -50px var(--glow)" }}
    >
      <div className="flex items-center gap-3 border-b border-border bg-muted px-5 py-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: "var(--border)" }} />
          <span className="size-2.5 rounded-full" style={{ background: "var(--border)" }} />
          <span className="size-2.5 rounded-full bg-primary" />
        </div>
        <span className="font-display text-sm font-semibold">DataSimplr AI</span>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary animate-dot" /> Live analysis
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.15fr_1fr]">
        <div className="border-border p-5 lg:border-r">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3">
            <FileSpreadsheet className="size-4 text-primary" />
            <span className="font-mono text-xs">Q2_Sales_Data.xlsx</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-subtle">
              Uploaded
            </span>
          </div>

          <div className="mt-5 flex justify-end">
            <p className="max-w-[84%] rounded-2xl rounded-br-sm border border-border bg-muted px-4 py-3 text-sm">
              Which products are performing poorly?
            </p>
          </div>

          <div className="mt-4 flex gap-3">
            <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent">
              <Sparkles className="size-3.5 text-accent-foreground" />
            </span>
            <div className="flex-1">
              <h4 className="text-base font-semibold">3 products need attention</h4>
              <div className="mt-3 space-y-2.5">
                {declines.map((d) => (
                  <div key={d.name} className="rounded-xl border border-border bg-muted px-3.5 py-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-brand">
                        <TrendingDown className="size-3.5" /> {d.value}
                      </span>
                    </div>
                    <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${d.bar}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">Ask a follow-up</p>
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3">
              <span className="flex-1 font-mono text-xs text-muted-foreground">
                Why did Product A decline?
              </span>
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary">
                <Send className="size-3.5 text-primary-foreground" />
              </span>
            </div>
          </div>
        </div>

        <div className="bg-muted p-5">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              Revenue by week
            </p>
            <p className="font-display text-sm font-semibold text-brand">-13.5%</p>
          </div>
          <div className="mt-5 flex h-44 items-end gap-1.5">
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  background: i > 8 ? "var(--primary)" : "var(--border)",
                  opacity: i > 8 ? 1 : 0.9,
                }}
              />
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              ["Records", "12,480"],
              ["Anomalies", "7"],
              ["Segments", "14"],
              ["Confidence", "96%"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border bg-card px-3.5 py-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{k}</p>
                <p className="mt-1 font-display text-lg font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
