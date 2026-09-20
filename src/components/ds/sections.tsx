import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Building2,
  Check,
  HeartPulse,
  LineChart,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Search,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";

function SectionHead({
  eyebrow,
  title,
  accent,
  copy,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  copy?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
        {title}
        {accent && (
          <>
            <br />
            <span className="text-brand">{accent}</span>
          </>
        )}
      </h2>
      {copy && <p className="mt-5 text-base leading-relaxed text-muted-foreground">{copy}</p>}
    </div>
  );
}

const steps = [
  {
    n: "01",
    title: "Upload",
    icon: Upload,
    body: "Documents, Excel, CSV, PDF and data files.",
  },
  { n: "02", title: "Ask", icon: MessageSquare, body: "Ask questions in natural language." },
  {
    n: "03",
    title: "Understand",
    icon: Brain,
    body: "AI identifies trends, patterns, anomalies and important findings.",
  },
  { n: "04", title: "Act", icon: Target, body: "Turn insights into reports, decisions and actions." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHead eyebrow="From data to outcomes" title="From Raw Data to Real Outcomes." />
        <div className="mt-14 grid gap-4 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.n} className="relative">
              <div className="panel h-full p-6 transition-colors hover:border-primary">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs tracking-widest text-subtle">{s.n}</span>
                  <s.icon className="size-4 text-primary" />
                </div>
                <h3 className="mt-6 font-mono text-sm uppercase tracking-[0.2em] text-foreground">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight className="absolute -right-3 top-1/2 hidden size-5 -translate-y-1/2 text-primary lg:block" />
              )}
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          <span>Upload</span>
          <ArrowRight className="size-4 text-primary" />
          <span>Ask</span>
          <ArrowRight className="size-4 text-primary" />
          <span>Understand</span>
          <ArrowRight className="size-4 text-primary" />
          <span>Act</span>
        </div>
      </div>
    </section>
  );
}

const questions = [
  "What changed this month?",
  "What is driving revenue?",
  "Which products are declining?",
  "Where are the anomalies?",
  "What should I investigate?",
  "Summarize this report.",
];

export function TalkToData() {
  return (
    <section id="product" className="relative border-t border-border bg-surface py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <span className="eyebrow">What is DataSimplr</span>
            <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
              Stop Digging Through Data.
              <br />
              <span className="text-brand">Start Talking to It.</span>
            </h2>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
              DataSimplr lets you interact with your data using natural language. You don't need to
              know SQL, Python, complex formulas, or advanced analytics. Upload your data and simply
              ask what you want to know.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {questions.map((q) => (
              <button
                key={q}
                className="group panel flex items-center gap-3 px-4 py-4 text-left text-sm transition-all hover:-translate-y-0.5 hover:border-primary"
              >
                <Search className="size-4 shrink-0 text-primary" />
                <span className="text-muted-foreground group-hover:text-foreground">{q}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const findings = [
  { n: "01", title: "Product decline", body: "Product X revenue decreased 21%.", metric: "-21%" },
  {
    n: "02",
    title: "Regional performance",
    body: "South region is 14% below the average.",
    metric: "-14%",
  },
  {
    n: "03",
    title: "Customer concentration",
    body: "Top 10 customers represent 58% of revenue.",
    metric: "58%",
  },
];

export function AiDemo() {
  return (
    <section className="relative border-t border-border py-24">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-5 lg:px-8">
        <SectionHead eyebrow="Interactive demonstration" title="Ask Your Data Anything." />
        <div className="panel mt-12 overflow-hidden">
          <div className="border-b border-border bg-muted px-6 py-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">You</span>
              <br />
              Analyze this sales file and tell me the three biggest problems.
            </p>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent">
                <Sparkles className="size-4 text-accent-foreground" />
              </span>
              <p className="font-display text-lg font-semibold">
                I found three areas worth investigating.
              </p>
            </div>
            <div className="mt-6 space-y-3">
              {findings.map((f) => (
                <div
                  key={f.n}
                  className="flex items-center gap-4 rounded-xl border border-border bg-muted px-5 py-4 transition-colors hover:border-primary"
                >
                  <span className="font-mono text-xs text-subtle">{f.n}</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{f.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
                  </div>
                  <span className="font-display text-lg font-bold text-brand">{f.metric}</span>
                </div>
              ))}
            </div>
            <a
              href="#use-cases"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand"
            >
              Explore this insight <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const insightCards = [
  { icon: TrendingUp, title: "Trends", body: "Discover what changed." },
  { icon: Search, title: "Patterns", body: "Find relationships hidden in your data." },
  { icon: AlertTriangle, title: "Anomalies", body: "Identify unusual behavior." },
  { icon: Lightbulb, title: "Insights", body: "Understand what matters." },
  { icon: BarChart3, title: "Visualize", body: "Turn analysis into charts." },
  { icon: Target, title: "Outcomes", body: "Move from information to action." },
];

export function InsightCards() {
  return (
    <section className="border-t border-border bg-surface py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHead eyebrow="What you get" title="Six Ways to See Your Data." />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {insightCards.map((c) => (
            <div
              key={c.title}
              className="group panel relative overflow-hidden p-6 transition-all hover:-translate-y-1 hover:border-primary"
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full opacity-0 blur-3xl transition-opacity group-hover:opacity-100"
                style={{ background: "var(--glow)" }}
              />
              <span className="relative flex size-10 items-center justify-center rounded-xl bg-accent">
                <c.icon className="size-5 text-accent-foreground" />
              </span>
              <h3 className="relative mt-5 text-lg font-semibold">{c.title}</h3>
              <p className="relative mt-2 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function NoSkills() {
  return (
    <section className="border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHead eyebrow="No technical skills required" title="Powerful Analysis." accent="Without the Complexity." />
        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <div className="panel p-7" style={{ opacity: 0.85 }}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">
              Traditional workflow
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {["Excel", "formulas", "SQL", "Python", "dashboards", "interpretation"].map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  <span className="rounded-lg border border-border px-3 py-1.5">{s}</span>
                  {i < 5 && <span className="text-subtle">→</span>}
                </span>
              ))}
            </div>
          </div>
          <div
            className="panel p-7"
            style={{ borderColor: "var(--primary)", boxShadow: "0 30px 70px -45px var(--glow)" }}
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-brand">DataSimplr</p>
            <div className="mt-5 flex flex-wrap items-center gap-3 font-display text-lg font-semibold">
              <span>Upload</span>
              <ArrowRight className="size-5 text-primary" />
              <span>Ask</span>
              <ArrowRight className="size-5 text-primary" />
              <span>Understand</span>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              You don't need to become a data scientist to understand your data.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const useCases = [
  { icon: Building2, title: "Business", body: "Analyze performance and KPIs.", bars: [40, 62, 55, 78] },
  { icon: Wallet, title: "Finance", body: "Understand revenue, costs and variance.", bars: [70, 45, 60, 52] },
  { icon: LineChart, title: "Sales", body: "Discover trends and opportunities.", bars: [30, 48, 66, 88] },
  { icon: Settings2, title: "Operations", body: "Identify bottlenecks and anomalies.", bars: [58, 42, 74, 50] },
  { icon: Megaphone, title: "Marketing", body: "Understand campaigns and customer behavior.", bars: [44, 70, 38, 64] },
  { icon: HeartPulse, title: "Healthcare", body: "Analyze operational and billing data.", bars: [52, 60, 47, 72] },
];

export function UseCases() {
  return (
    <section id="use-cases" className="border-t border-border bg-surface py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHead eyebrow="Use cases" title="One Platform." accent="Many Questions." />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((u) => (
            <div key={u.title} className="panel p-6 transition-colors hover:border-primary">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent">
                  <u.icon className="size-4 text-accent-foreground" />
                </span>
                <h3 className="text-base font-semibold">{u.title}</h3>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{u.body}</p>
              <div className="mt-6 flex h-12 items-end gap-1.5">
                {u.bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm"
                    style={{
                      height: `${h}%`,
                      background: i === u.bars.length - 1 ? "var(--primary)" : "var(--border)",
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const plans = [
  {
    name: "Starter",
    price: "$0",
    note: "For first questions",
    features: ["3 files per month", "Natural language chat", "Core visualizations"],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$29",
    note: "Per user / month",
    features: [
      "Unlimited uploads",
      "Advanced anomaly detection",
      "Shareable insight reports",
      "Priority AI analysis",
    ],
    cta: "Start Analyzing →",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    note: "For data teams",
    features: ["SSO & access controls", "Private deployment", "Audit logs", "Dedicated support"],
    cta: "Talk to us",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="border-t border-border py-24">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHead
          eyebrow="Pricing"
          title="Simple Plans."
          accent="Serious Analysis."
          copy="Start free. Upgrade when your questions get bigger."
        />
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.name}
              className="panel flex flex-col p-7"
              style={
                p.featured
                  ? { borderColor: "var(--primary)", boxShadow: "0 36px 80px -50px var(--glow)" }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{p.name}</p>
                {p.featured && (
                  <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-accent-foreground">
                    Popular
                  </span>
                )}
              </div>
              <p className="mt-5 font-display text-4xl font-bold">{p.price}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.note}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to={p.name === "Enterprise" ? "/auth" : "/try"}
                className={`mt-7 rounded-xl px-5 py-3 text-center text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
                  p.featured
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-muted text-foreground"
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section id="resources" className="relative overflow-hidden border-t border-border py-28">
      <div className="absolute inset-0 grid-bg opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 bottom-[-40%] h-[420px] w-[720px] -translate-x-1/2 rounded-full blur-[130px]"
        style={{ background: "var(--glow)", opacity: 0.4 }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-3xl px-5 text-center lg:px-8">
        <span className="eyebrow">Make data simple for outcomes</span>
        <h2 className="mt-4 text-3xl font-bold leading-tight sm:text-5xl">
          Upload a File.
          <br />
          <span className="text-brand">Get Answers in Seconds.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
          Bring your spreadsheets, reports and exports. DataSimplr does the analysis and explains it
          in plain language.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/try"
            className="w-full rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            Analyze Your Data →
          </Link>
          <a
            href="#pricing"
            className="w-full rounded-xl border border-border bg-card px-6 py-3.5 text-sm font-semibold transition-colors hover:border-primary sm:w-auto"
          >
            View Pricing
          </a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface py-14">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <p className="font-display text-lg font-bold">⚡ DataSimplr</p>
            <p className="mt-3 text-sm text-muted-foreground">Make Data Simple for Outcomes.</p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {[
              { h: "Product", items: ["Overview", "AI Chat", "Visualizations", "Security"] },
              { h: "Use Cases", items: ["Business", "Finance", "Sales", "Operations"] },
              { h: "Company", items: ["About", "Blog", "Careers", "Contact"] },
            ].map((col) => (
              <div key={col.h}>
                <p className="font-mono text-[10px] uppercase tracking-widest text-subtle">{col.h}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.items.map((i) => (
                    <li key={i}>
                      <a href="#top" className="text-sm text-muted-foreground hover:text-primary">
                        {i}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-subtle sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} DataSimplr. All rights reserved.</p>
          <p className="font-mono uppercase tracking-widest">Upload · Ask · Understand · Act</p>
        </div>
      </div>
    </footer>
  );
}
