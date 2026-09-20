import { createFileRoute, Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { ThemeToggle } from "@/components/ds/theme-toggle";
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
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
              <Zap className="size-4 text-primary-foreground" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">DataSimplr</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in to save
            </Link>
            <Link
              to="/auth"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Create workspace
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 lg:px-8">
        <div className="mb-6">
          <p className="eyebrow">No account required</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Analytics workspace</h1>
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
