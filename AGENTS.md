# DataSimplr

TanStack Start + React app. Routes live in `src/routes/` (file-based). Do not invent a `src/pages/` tree.

Analytics math is in `src/lib/analysis.ts`. File parsers are in `src/lib/parse-file.ts`. The shared workspace UI is `src/components/workspace/analytics-studio.tsx`.

Public try-it path: `/try`. Authenticated analyze path: `/analyze`.

AI chat uses Groq (`GROQ_API_KEY` → `https://api.groq.com/openai/v1`) in `src/lib/ai.functions.ts`. Keep keys in `.env.local`, never in source.

Avoid force-pushing or rewriting published git history on `main`.
