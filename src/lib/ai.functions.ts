import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
});

const SYSTEM = `You are DataSimplr's expert data assistant.
You help with data analysis, statistics, data science, machine learning, RAG and LLM systems, evaluation, MLOps and SQL.
Be direct and practical. Structure answers with short paragraphs, bullet lists or numbered steps.
Show SQL or Python in fenced code blocks when it helps. State what you would verify first when data is missing.
Keep answers under 350 words unless the user asks for depth.`;

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return {
        reply:
          "The AI service isn't configured for this workspace yet, so I can't generate a live answer. Your chat is still saved — try again once AI access is available.",
      };
    }

    const system = data.context ? `${SYSTEM}\n\nDataset context:\n${data.context}` : SYSTEM;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.8-flash",
        messages: [{ role: "system", content: system }, ...data.messages],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("AI gateway error", res.status, detail);
      if (res.status === 429) {
        return { reply: "Too many requests right now. Please wait a moment and ask again." };
      }
      return { reply: "I couldn't reach the AI service just now. Please try again." };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return {
      reply: json.choices?.[0]?.message?.content?.trim() || "I didn't get a response. Try again.",
    };
  });
