import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getServerEnv } from "@/lib/server-env";
import { queryOpSchema, type QueryOp } from "@/lib/dataset-query";

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

## What DataSimplr actually is — ground truth, never invent beyond this
DataSimplr is this website. There is no SDK, no pip package, no separate app, no other domain, and no
API key for the user to manage. If asked about product features, tools, pricing, or "how do I...",
answer ONLY from the facts below, and point to /help for the full guide. If something isn't listed here,
say it doesn't exist in DataSimplr — never invent a plausible-sounding feature, URL, package, or workflow.

- Sign-in (/auth) is email + password via the site itself. No magic link, no Google/social login, no SDK.
- Upload & Analyze (/analyze, or /try without an account) runs these tools client-side in the browser —
  no Python needed: Dataset profile, Summary statistics, Missing values, Outlier scan, Correlation,
  Trend & change, Segment breakdown, Linear regression (first two numeric columns), Clustering
  (k-means, k=3), PCA reduction (2 components), Executive insights. Supported files: .xlsx/.xls (first
  worksheet only), .csv, .tsv, .json (array or single object). Max 50 MB. No PDF/Word here.
- AI Chat (here) accepts attachments: .xlsx/.xls (with a sheet picker when the workbook has more than
  one worksheet), .csv, .tsv, .json, .txt, .md, .docx, and .pdf — all read directly in the browser. Old
  binary .doc is not supported (ask the user to save as .docx). Scanned PDFs/images with no real text
  layer can't be read. Pasting a comma- or tab-separated table straight into the chat box is also
  recognised as a dataset automatically. If the user recently cleaned or analysed a file in Upload &
  Analyze, chat offers a one-click "continue with that file" option instead of re-uploading.
- PythonLab opens from the "Python lab" button in chat, from a "Run in PythonLab" button under a code block in chat, or from My Datasets. It is Pyodide — real Python
  running entirely in the user's browser tab, no install, no server execution. Only pandas, numpy, and
  matplotlib are available. It does NOT have scikit-learn, TensorFlow, PyTorch, network access, or a
  database connection — for anything those would do, point the user to the Regression/Clustering/PCA
  tools in Upload & Analyze instead, not to a Python library that isn't there.
- My Datasets (/datasets) holds datasets the user saved from Upload & Analyze. Each has a quality workspace
  (issues, before/after preview, cleaning log, undo, finalize), and can be opened in Chat or PythonLab so the
  user never re-uploads. When Chat is on a saved dataset, numbers in answers come from operations actually run
  on that dataset version and sheet — the "Computed results" section of the context — not from memory.
- Settings (/settings) only has display name and a profile picture URL. Email isn't editable there. No
  password change, billing, or API keys anywhere in the product.
- Chats and analyses are saved to the user's account automatically once signed in.

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
Python examples only when code is requested, and only using pandas / numpy / matplotlib — that's all the
Python Lab actually runs. Never suggest scikit-learn, TensorFlow, or PyTorch; it will fail if the user runs
it. Never use input() — the Lab runs the whole script at once with no terminal to type into, so it always
fails there. For a simple practice program (palindrome check, prime check, string reversal, etc.), hardcode
a few example values in a list and loop over them instead, e.g. tests = ["Racecar", "Hello"]. Fence code as
\`\`\`python.

When a saved dataset is active in Chat, the variable df in PythonLab already holds that exact version and
sheet. For requests to chart, plot, cluster, regress or otherwise analyse it, give a one-line plan and one
python block that uses df directly (never read a file, never call input()), so the user can click "Run in
PythonLab".

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
      choices?: { message?: { content?: string; reasoning?: string }; finish_reason?: string }[];
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const reply = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!reply) {
      console.error("Groq returned no content", json.choices?.[0]?.finish_reason, model);
      const truncated = json.choices?.[0]?.finish_reason === "length";
      return {
        reply: truncated
          ? "That reply ran out of room while reasoning about this much text. Try the Smart · GPT-OSS 120B model, or ask a narrower question."
          : "I didn't get a response. Please try again.",
      };
    }
    return { reply };
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



const planSchema = z.object({
  question: z.string().min(1).max(2000),
  recent: z.array(z.string().max(500)).max(4).optional(),
  schema: z.object({
    name: z.string().max(300),
    rows: z.number(),
    columns: z
      .array(z.object({ name: z.string().max(120), type: z.string().max(20), sample: z.array(z.string().max(60)).max(4) }))
      .max(60),
  }),
  model: z.string().max(80).optional(),
});

const PLANNER = `You turn a question about a tabular dataset into a small JSON plan of operations that a program will run on the real data. You never answer the question and never invent numbers.

Reply with ONLY a JSON object: {"ops": [ ... ]} with 0 to 4 operations, using ONLY these shapes (column names must be copied exactly from the schema):
- {"op":"describe"}                                   profile of every column
- {"op":"quality"}                                    data-quality score and still-flagged issues
- {"op":"aggregate","metric":COL,"agg":"sum|avg|min|max|median|count","filters":[FILTER]}   (count needs no metric)
- {"op":"group","groupBy":[COL] or [COL,COL],"metric":COL,"agg":AGG,"sort":"asc|desc","limit":N,"filters":[FILTER]}
- {"op":"top_n","by":COL,"n":N,"order":"asc|desc","columns":[COL,...],"filters":[FILTER]}
- {"op":"time_trend","dateColumn":COL,"metric":COL,"agg":AGG,"granularity":"day|week|month|quarter|year","filters":[FILTER]}
- {"op":"compare","column":COL,"values":[V1,V2],"metric":COL,"agg":AGG,"filters":[FILTER]}
- {"op":"value_counts","column":COL,"limit":N,"filters":[FILTER]}
- {"op":"correlation","columns":[COL,...]}
FILTER = {"column":COL,"op":"eq|neq|gt|gte|lt|lte|contains|in","value":VALUE}

Rules: "top products by revenue" = group by the product column with agg sum on the revenue column, sort desc. For "summarize/overview/management summary" use describe, quality and, when there are several numeric columns, correlation. For questions about data quality or what is left unresolved use quality. For "unusual/anomalies" use quality plus time_trend when a date column exists. If the question needs no computation (a pure concept question) return {"ops":[]}. If the question refers to something that isn't in the schema, return {"ops":[]}. Use the recent questions only to resolve words like "it" or "that".`;

export const planDatasetQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => planSchema.parse(data))
  .handler(async ({ data }): Promise<{ ops: QueryOp[] }> => {
    const apiKey = await getServerEnv("GROQ_API_KEY");
    if (!apiKey || !apiKey.startsWith("gsk_")) return { ops: [] };

    const allowed = new Set<string>(GROQ_MODELS.map((m) => m.id));
    const model = data.model && allowed.has(data.model) && !data.model.startsWith("groq/") ? data.model : DEFAULT_GROQ_MODEL;
    const user = [
      `Dataset: ${data.schema.name} (${data.schema.rows} rows)`,
      "Columns:",
      ...data.schema.columns.map((c) => `- ${c.name} [${c.type}] e.g. ${c.sample.join(" | ")}`),
      data.recent?.length ? `Recent questions: ${data.recent.join(" / ")}` : "",
      `Question: ${data.question}`,
    ]
      .filter(Boolean)
      .join("\n");

    const body = (jsonMode: boolean) =>
      JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1800,
        ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: PLANNER },
          { role: "user", content: user },
        ],
      });
    const call = (jsonMode: boolean) =>
      fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: body(jsonMode),
      });

    let res = await call(true);
    if (!res.ok) res = await call(false);
    if (!res.ok) {
      console.error("Groq planner error", res.status, await res.text());
      return { ops: [] };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (json.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return { ops: [] };
    try {
      // Models often emit null for unused optional fields; treat null as "absent".
      const parsed = JSON.parse(text.slice(start, end + 1), (_k, v) => (v === null ? undefined : v)) as { ops?: unknown };
      const raw = Array.isArray(parsed.ops) ? parsed.ops.slice(0, 4) : [];
      const ops: QueryOp[] = [];
      for (const item of raw) {
        const ok = queryOpSchema.safeParse(item);
        if (ok.success) ops.push(ok.data);
        else console.error("Planner operation rejected", JSON.stringify(item), ok.error.issues[0]?.message);
      }
      return { ops };
    } catch {
      return { ops: [] };
    }
  });
