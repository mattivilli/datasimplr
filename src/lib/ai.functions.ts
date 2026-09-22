import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "@/lib/server-env";

export const GROQ_MODELS = [
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", badge: "Economy", desc: "Best cost / speed on Groq free" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", badge: "Smart", desc: "Best free reasoning for analysis" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", badge: "Fast", desc: "Quick answers, tighter token cap" },
  { id: "groq/compound", label: "Groq Compound", badge: "Tools", desc: "Agent with search — 250 chats/day" },
  { id: "groq/compound-mini", label: "Compound Mini", badge: "Lite", desc: "Lighter compound agent" },
] as const;

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

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
  context: z.string().max(16000).optional(),
  model: z.string().max(80).optional(),
});

const SYSTEM = `You are DataSimplr AI — a senior data analyst writing for a busy operator, not a chatbot.

Brand: Make Data Simple for Outcomes.

## How to think
- If a dataset/document is attached, treat it as source of truth. Use real column names and numbers from context. Never invent rows, metrics, or currencies.
- Prefer the smallest claim that the numbers support. If the file is too thin, say what is missing.
- Stay inside data analysis, statistics, ML, SQL, visualisation, and DataSimplr product help. Decline other topics in one sentence and steer back.

## How to write (always)
Use GitHub-flavoured Markdown. No preamble ("Sure!", "Great question"). No emoji walls.

For file analysis, use this skeleton (omit a section only if it does not apply):

### Snapshot
One or two sentences: what the file is, grain (row = ?), and size.

### Key findings
3–5 bullets. Lead each bullet with a **bold metric or name**, then the implication.

### Evidence
A compact markdown table when numbers help (column | value | note). Round intelligently (2 decimals, or thousands separators).

### Data quality
Missing values, outliers, weak types, leakage risk. If clean, say so in one line.

### Next action
One numbered step the user should take in DataSimplr (clean, correlation, regression, clustering, PCA) and why.

For conceptual questions: short definition, then a concrete example, then when to use it. Keep under 250 words unless the user asks for depth.
Python examples only when code is requested — pandas / scikit-learn, fenced as \`\`\`python.

English only.`;

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = await getServerEnv("GROQ_API_KEY");
    if (!apiKey || !apiKey.startsWith("gsk_")) {
      return {
        reply:
          "Groq is not configured yet. Add GROQ_API_KEY (starts with gsk_) to .env.local, restart the server, then ask again. Your chat is still saved.",
      };
    }

    const allowed = new Set<string>(GROQ_MODELS.map((m) => m.id));
    const model = (
      data.model && allowed.has(data.model) ? data.model : DEFAULT_GROQ_MODEL
    ) as (typeof GROQ_MODELS)[number]["id"];
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
        temperature: 0.3,
        max_tokens: 900,
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
      choices?: { message?: { content?: string; reasoning?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const reply = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    return {
      reply: reply || "I didn't get a response. Please try again.",
    };
  });

const fixSchema = z.object({
  code: z.string().min(1).max(12000),
  error: z.string().min(1).max(6000),
  columns: z.array(z.string()).max(40).optional(),
  fileName: z.string().max(200).optional(),
});

export const fixPython = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => fixSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = await getServerEnv("GROQ_API_KEY");
    if (!apiKey || !apiKey.startsWith("gsk_")) {
      return { reply: "Groq is not configured. Add GROQ_API_KEY in .env.local.", code: "" };
    }

    const cols = data.columns?.length ? data.columns.join(", ") : "unknown";
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_GROQ_MODEL,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              "You fix Python for DataSimplr's browser lab. Only pandas, numpy, matplotlib. plt is already imported. df is already loaded. The upload also lives at DATA_PATH (/work/data.csv) and under its original filename in /work. If code calls pd.read_csv('some name.csv'), that is fine. Never invent another path. Never use sklearn, tensorflow, torch, requests, or open(). Return a short diagnosis, then one ```python``` block with the full corrected script.",
          },
          {
            role: "user",
            content: `File: ${data.fileName ?? "uploaded.csv"}\nColumns: ${cols}\n\nCode:\n\`\`\`python\n${data.code}\n\`\`\`\n\nError:\n${data.error}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Groq fix error", res.status, detail);
      return { reply: "I couldn't reach Groq to fix this. Try again in a moment.", code: "" };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "";
    const match = reply.match(/```(?:python)?\n([\s\S]*?)```/i);
    return { reply, code: match?.[1]?.trim() ?? "" };
  });

