import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ds/theme-toggle";
import { LogoMark } from "@/components/ds/logo";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & Support — DataSimplr" },
      {
        name: "description",
        content:
          "How to use DataSimplr: signing in, the AI chat, the in-browser Python Lab, Upload & Analyze tools, and settings.",
      },
    ],
  }),
  component: HelpPage,
});

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-24 p-5 sm:p-6">
      <h2 className="font-display text-lg font-bold sm:text-xl">{title}</h2>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground">
        {children}
      </div>
    </section>
  );
}

const groqModels = [
  { badge: "Economy", label: "GPT-OSS 20B", desc: "Default. Best cost/speed on Groq's free tier." },
  { badge: "Smart", label: "GPT-OSS 120B", desc: "Best free reasoning for deeper analysis." },
  { badge: "Fast", label: "Qwen 3.8 27B", desc: "Quick answers, tighter token cap." },
  { badge: "Tools", label: "Groq Compound", desc: "Agent with web search — 250 chats/day." },
  { badge: "Lite", label: "Compound Mini", desc: "Lighter version of the compound agent." },
];

const analyzeTools = [
  ["Dataset profile", "Shape, column types, and distinct-value counts."],
  ["Summary statistics", "Mean, median, min, max, std, skew and kurtosis per numeric column."],
  ["Missing values", "Blank/null counts per column, ranked by how much of the column is missing."],
  ["Outlier scan", "Flags values more than 3 standard deviations from a column's mean."],
  ["Correlation", "Pearson correlation across numeric columns, ranked strong/moderate/weak."],
  ["Trend & change", "Compares the first half of the data to the second half per numeric column."],
  ["Segment breakdown", "Totals and averages of the first numeric column, grouped by the first text column."],
  ["Linear regression", "Simple regression between the first two numeric columns (intercept, coefficient, R²)."],
  ["Clustering", "K-means clustering (k = 3) on up to 6 numeric columns."],
  ["PCA reduction", "2-component principal component analysis on up to 8 numeric columns."],
  ["Executive insights", "A plain-language summary combining the findings above."],
];

function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <LogoMark />
            <span className="truncate font-display text-lg font-bold tracking-tight">DataSimplr</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              to="/auth"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground sm:px-4 sm:text-sm"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-5">
        <div className="mb-8">
          <p className="eyebrow">Help &amp; support</p>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">How DataSimplr works</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            DataSimplr is a website — everything below runs in this app or in your browser tab. There's no
            separate app, API key, or software to install.
          </p>
        </div>

        <nav className="panel mb-6 flex flex-wrap gap-x-4 gap-y-2 p-4 text-xs">
          {[
            ["getting-started", "Getting started"],
            ["ai-chat", "AI Chat"],
            ["python-lab", "Python Lab"],
            ["analyze", "Upload & Analyze"],
            ["analyses", "Past Analyses"],
            ["settings", "Settings"],
            ["faq", "FAQ"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="text-primary hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <div className="space-y-6">
          <Section id="getting-started" title="Getting started">
            <p>
              <strong>Try it without an account:</strong> go to <code>/try</code> and upload a spreadsheet —
              cleaning, stats, correlation, regression, clustering and PCA all run in your browser. Nothing
              is saved until you sign in.
            </p>
            <p>
              <strong>Create an account:</strong> click <strong>Sign In</strong>, then{" "}
              <strong>"Create an account"</strong> on the <code>/auth</code> page. Sign-in is email and
              password only (no magic link, no Google/social login). If your project requires email
              confirmation, you'll get a confirmation link by email before you can sign in.
            </p>
            <p>
              Once signed in, your <strong>Dashboard</strong> shows your saved chats, analyses, and quick
              links to AI Chat, Upload &amp; Analyze, and Past Analyses.
            </p>
          </Section>

          <Section id="ai-chat" title="AI Chat">
            <p>
              The AI Chat answers data, statistics, ML and SQL questions, and can analyse a file you attach.
              It's powered by Groq — pick a model from the dropdown at the top of the chat:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              {groqModels.map((m) => (
                <li key={m.label}>
                  <strong>
                    {m.badge} · {m.label}
                  </strong>{" "}
                  — {m.desc}
                </li>
              ))}
            </ul>
            <p>
              <strong>Attaching a file:</strong> use the paperclip button or drag a file onto the chat.{" "}
              <code>.xlsx</code>, <code>.xls</code>, <code>.csv</code>, <code>.tsv</code>, <code>.json</code>
              , <code>.txt</code> and <code>.md</code> are read directly. PDF and Word files are read on a
              best-effort basis only — if the file doesn't contain enough plain text, you'll be asked to
              export it as CSV, Excel, TXT or JSON instead.
            </p>
            <p>Chats are saved to your account automatically once you're signed in.</p>
          </Section>

          <Section id="python-lab" title="Python Lab">
            <p>
              When an AI reply includes a code block, a <strong>"Run in lab"</strong> button opens the{" "}
              <strong>Python Lab</strong> — a real Python environment that runs entirely in your browser tab
              (via Pyodide/WebAssembly). There's nothing to install, and no code is sent to a server to run.
            </p>
            <p>
              <strong>Available: pandas, numpy, and matplotlib only.</strong> The Lab does not support
              scikit-learn, TensorFlow, PyTorch, network requests, or database connections — use the built-in
              Regression, Clustering and PCA tools in Upload &amp; Analyze for that instead. Your attached
              file is preloaded as a pandas DataFrame named <code>df</code>.
            </p>
            <p>If code fails, the "Ask AI to fix" button sends the error back to the AI for a fix.</p>
          </Section>

          <Section id="analyze" title="Upload & Analyze">
            <p>
              Upload a spreadsheet at <code>/analyze</code> (or <code>/try</code> without an account) and run
              any of these tools — each is computed instantly in your browser, no Python required:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              {analyzeTools.map(([name, desc]) => (
                <li key={name}>
                  <strong>{name}</strong> — {desc}
                </li>
              ))}
            </ul>
            <p>
              <strong>Supported files:</strong> <code>.xlsx</code>/<code>.xls</code> (first worksheet only),{" "}
              <code>.csv</code>, <code>.tsv</code>, and <code>.json</code> (an array of objects, or a single
              object). Maximum file size is 50 MB. PDF and Word files aren't supported here — attach them in
              AI Chat instead.
            </p>
          </Section>

          <Section id="analyses" title="Past Analyses">
            <p>
              Every analysis you save from <code>/analyze</code> appears at <code>/analyses</code>, with its
              summary and findings. Open one to see the full results, or delete it from the list. Click{" "}
              <strong>"Run another tool"</strong> from a saved analysis to start a new one.
            </p>
          </Section>

          <Section id="settings" title="Settings">
            <p>
              At <code>/settings</code> you can change your <strong>display name</strong> and{" "}
              <strong>profile picture</strong> (by URL — there's no image upload here). Your email is shown
              but can't be changed from this page. There's no password change, billing, or API key
              management in Settings.
            </p>
          </Section>

          <Section id="faq" title="Frequently asked questions">
            <p>
              <strong>Is there a DataSimplr SDK, API, or a separate app to install?</strong> No. DataSimplr
              is this website. There's no package to <code>pip install</code>, no separate domain, and no
              API key for you to manage — the AI chat's Groq key and Supabase project are configured on the
              server side.
            </p>
            <p>
              <strong>Can I use my own OpenAI or Anthropic key?</strong> No — AI Chat only uses the Groq
              models listed above.
            </p>
            <p>
              <strong>Can the Python Lab use scikit-learn, TensorFlow, or connect to a database?</strong> No
              — only pandas, numpy and matplotlib run in the browser sandbox. Use the Upload &amp; Analyze
              tools (Regression, Clustering, PCA) for anything those libraries would normally do.
            </p>
            <p>
              <strong>Where is my data stored?</strong> Uploaded files are processed in your browser. Saved
              chats and analyses are stored in your account so you can come back to them later.
            </p>
          </Section>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Still stuck? Ask the AI directly in{" "}
          <Link to="/chat" search={{ c: undefined }} className="text-primary hover:underline">
            AI Chat
          </Link>{" "}
          —
          it knows everything on this page.
        </p>
      </main>
    </div>
  );
}
