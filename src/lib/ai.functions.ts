import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const GROQ_MODELS = [
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", badge: "Best", desc: "Recommended — most reliable" },
  { id: "groq/compound", label: "Groq Compound", badge: "Smart", desc: "Most capable compound model" },
  { id: "groq/compound-mini", label: "Groq Compound Mini", badge: "Fast", desc: "Fast & reliable compound model" },
  { id: "allam-2-7b", label: "Allam 2 7B", badge: "New", desc: "Specialized 7B model" },
] as const;

export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  context: z.string().max(4000).optional(),
  model: z.string().max(80).optional(),
});

const SYSTEM = `You are **DataSimplr AI**, an expert data scientist and ML educator embedded in the DataSimplr AI Data Analytics Platform. Your brand promise is "Make Data Simple for Outcomes".

## Your Role
You help users:
1. **Analyse their uploaded data** — provide deep statistical insights, interpret results, spot patterns
2. **Explain data science & ML concepts** — correlation, regression, clustering, PCA, hypothesis testing, feature engineering, model evaluation, etc.
3. **Guide analysis decisions** — which model to use, how to interpret outputs, what to investigate next
4. **Teach AI/ML/data science** — explain algorithms, math intuitions, real-world applications
5. **Recommend tools & libraries** — Python (pandas, scikit-learn, seaborn), R, Excel, Power BI, etc.

## Topic Scope (STRICT)
Only answer questions related to:
- Data analysis, statistics, data cleaning, EDA
- Machine learning (supervised, unsupervised, reinforcement)
- Deep learning & AI (NLP, computer vision, transformers, LLMs)
- Data visualization best practices
- Educational content about data science tools (Jupyter, Colab, VS Code, KNIME, Orange, Tableau, etc.)
- The DataSimplr app features

If asked about unrelated topics (cooking, sports, politics, coding unrelated to data science), politely decline and redirect.

## Response Style
- Be concise but thorough. Use bullet points and bold for key metrics.
- Use emojis sparingly for visual clarity.
- When referencing statistics, use exact numbers from the dataset context.
- If suggesting a next step, reference the DataSimplr panel it corresponds to.
- For code examples, use Python with pandas/scikit-learn.
- Always provide a "Next Step" or "Action" at the end of analytical responses.
- You MUST provide all your responses entirely in English.`;

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey || !apiKey.startsWith("gsk_")) {
      return {
        reply:
          "Groq is not configured yet. Add GROQ_API_KEY (starts with gsk_) to .env.local, restart the server, then ask again. Your chat is still saved.",
      };
    }

    const allowed = new Set(GROQ_MODELS.map((m) => m.id));
    const model = data.model && allowed.has(data.model) ? data.model : DEFAULT_GROQ_MODEL;
    const system = data.context ? `${SYSTEM}\n\n## Current Dataset Context\n${data.context}` : SYSTEM;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...data.messages.slice(-12)],
        temperature: 0.65,
        max_tokens: 1800,
        top_p: 0.9,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Groq API error", res.status, detail);
      if (res.status === 429) {
        return { reply: "Too many requests right now. Please wait a moment and ask again." };
      }
      if (res.status === 401) {
        return { reply: "Groq rejected the API key. Check GROQ_API_KEY in .env.local." };
      }
      return { reply: "I couldn't reach Groq just now. Please try again." };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return {
      reply: json.choices?.[0]?.message?.content?.trim() || "I didn't get a response. Try again.",
    };
  });

