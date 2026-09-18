import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/ds/nav";
import { Hero } from "@/components/ds/hero";
import {
  AiDemo,
  FinalCta,
  Footer,
  HowItWorks,
  InsightCards,
  NoSkills,
  Pricing,
  TalkToData,
  UseCases,
} from "@/components/ds/sections";

const title = "DataSimplr — Make Data Simple for Outcomes";
const description =
  "Upload documents, spreadsheets and datasets. Ask questions in plain language and let AI turn complex data into clear insights and actionable outcomes.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <TalkToData />
        <AiDemo />
        <InsightCards />
        <NoSkills />
        <UseCases />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
