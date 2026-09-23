import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ds/theme-toggle";
import { LogoMark } from "@/components/ds/logo";
import { AnalyticsStudio } from "@/components/workspace/analytics-studio";

export const Route = createFileRoute("/try")({
  head: () => ({
    meta: [
      { title: "Analytics Workspace — DataSimplr" },
      {
        name: "description",
        content: "Upload a spreadsheet and run cleaning, stats, regression, clustering and PCA in your browser.",
      },
    ],
  }),
  component: TryPage,
});

function TryPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-5 lg:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <LogoMark />
            <span className="truncate font-display text-lg font-bold tracking-tight">DataSimplr</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link to="/auth" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
              Sign in to save
            </Link>
            <Link
              to="/auth"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground sm:px-4 sm:text-sm"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-5 lg:px-8">
        <div className="mb-6">
          <p className="eyebrow">No account required</p>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">Analytics workspace</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Cleaning, descriptive stats, correlation, regression, k-means and PCA run locally in your
            browser. Sign in when you want chats and analyses saved.
          </p>
        </div>
        <AnalyticsStudio />
      </main>
    </div>
  );
}
