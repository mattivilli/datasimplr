# DataSimplr

TanStack Start + React app. Routes live in `src/routes/` (file-based). Do not invent a `src/pages/` tree.

Analytics math is in `src/lib/analysis.ts`. File parsers are in `src/lib/parse-file.ts`. The shared workspace UI is `src/components/workspace/analytics-studio.tsx`.

Public try-it path: `/try`. Authenticated analyze path: `/analyze`.

AI chat uses SpaceXAI (`XAI_API_KEY` → `https://api.x.ai/v1`, model `grok-4.5`) in `src/lib/ai.functions.ts`. Keep keys server-side.

Avoid force-pushing or rewriting published git history on `main`.
