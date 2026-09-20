# DataSimplr

Make data simple for outcomes. Upload spreadsheets, clean them, run statistics, regression, clustering and PCA, then ask an AI analyst in plain language.

## Local development

```sh
git clone https://github.com/mattivilli/datasimplr.git
cd datasimplr
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- Public analytics workspace: `/try` (no account)
- Saved workspace, chats and analyses: `/auth` then `/dashboard`

## What’s included

- Excel / CSV / JSON upload (parsed in the browser)
- Missing-value fill, duplicate removal
- Descriptive stats, correlation heatmap
- Simple and multiple linear regression
- K-means clustering and PCA
- Executive insights
- Optional saved AI chats (set `XAI_API_KEY`)

## Environment

Copy `.env.example` to `.env`. Supabase holds accounts and saved analyses. SpaceXAI (`XAI_API_KEY`, `https://api.x.ai/v1`) powers the expert chat.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
