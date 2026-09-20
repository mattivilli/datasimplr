import { Link } from "@tanstack/react-router";
import { ProductMock } from "./product-mock";

function HeroBackground() {
  const dots = [
    [12, 22],
    [28, 64],
    [45, 18],
    [62, 72],
    [78, 34],
    [88, 58],
    [20, 84],
    [70, 12],
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-70" />
      <div
        className="absolute left-1/2 top-[-20%] h-[520px] w-[820px] -translate-x-1/2 rounded-full blur-[120px]"
        style={{ background: "var(--glow)", opacity: 0.35 }}
      />
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <path
          d="M0,320 C240,220 360,420 640,300 C900,190 1080,380 1440,260"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.18"
          strokeWidth="1.5"
          strokeDasharray="10 14"
          className="animate-dash"
        />
        <path
          d="M0,460 C260,400 420,520 700,430 C960,350 1160,500 1440,420"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.1"
          strokeWidth="1"
          strokeDasharray="4 18"
          className="animate-dash"
        />
      </svg>
      {dots.map(([x, y], i) => (
        <span
          key={i}
          className="absolute size-1.5 rounded-full animate-dot"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            background: "var(--primary)",
            animationDelay: `${i * 0.45}s`,
          }}
        />
      ))}
      <div className="absolute left-[8%] top-[46%] font-mono text-[10px] tracking-widest text-subtle opacity-50">
        +18.4%
      </div>
      <div className="absolute right-[10%] top-[30%] font-mono text-[10px] tracking-widest text-subtle opacity-50">
        n=12,480
      </div>
      <div className="absolute right-[18%] bottom-[16%] font-mono text-[10px] tracking-widest text-subtle opacity-40">
        σ 0.42
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-20 lg:pt-40">
      <HeroBackground />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <span className="eyebrow animate-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            AI-Powered Data Analysis
          </span>
          <h1 className="animate-rise mt-7 text-4xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
            Your Data Has Answers.
            <br />
            <span className="text-brand">DataSimplr Finds Them.</span>
          </h1>
          <p className="animate-rise mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Upload documents, spreadsheets, and datasets. Ask questions in plain language and let AI
            turn complex data into clear insights and actionable outcomes.
          </p>
          <div className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/try"
              className="w-full rounded-xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:w-auto"
              style={{ boxShadow: "0 18px 40px -18px var(--glow)" }}
            >
              Analyze Your Data →
            </Link>
            <Link
              to="/auth"
              className="w-full rounded-xl border border-border bg-card px-6 py-3.5 text-sm font-semibold text-foreground transition-colors hover:border-primary sm:w-auto"
            >
              Meet the AI Assistant
            </Link>
          </div>
          <a
            href="#expert-chat"
            className="animate-rise mx-auto mt-6 flex w-fit items-center gap-2.5 rounded-full border border-border bg-card/60 px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <span className="size-1.5 rounded-full bg-primary animate-dot" />
            Also an expert chat for data science, AI/ML, RAG & SQL questions
            <span className="text-primary">→</span>
          </a>
        </div>

        <div className="animate-rise mt-16 lg:mt-20">
          <ProductMock />
        </div>
      </div>
    </section>
  );
}
