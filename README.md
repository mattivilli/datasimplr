# DataSimplr

Make data simple for outcomes. Upload spreadsheets, clean them, run statistics, regression, clustering and PCA, then ask an AI analyst in plain language.

## Local development

```sh
git clone https://github.com/mattivilli/datasimplr.git
cd datasimplr
npm install
npm run dev
```

Open [http://localhost/datasimplr/](http://localhost/datasimplr/) (Apache + XAMPP). Direct Vite: [http://localhost:8080/datasimplr/](http://localhost:8080/datasimplr/).

- Public analytics workspace: `/try` (no account)
- Saved workspace, chats and analyses: `/auth` then `/dashboard`

## What’s included

- Excel / CSV / JSON upload (parsed in the browser)
- Missing-value fill, duplicate removal
- Descriptive stats, correlation heatmap
- Simple and multiple linear regression
- K-means clustering and PCA
- Executive insights
- Optional saved AI chats (set `GROQ_API_KEY`)

## Environment

Copy `.env.example` to `.env` / `.env.local`. Supabase holds accounts and saved analyses. Groq (`GROQ_API_KEY`, `https://api.groq.com/openai/v1`) powers the expert chat.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
