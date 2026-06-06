# Virgo ACP Dashboard — Node.js port

A faithful Node.js / Express port of the original Google Apps Script "Virgo ACP
Dashboard" web app. The UI, styling and client logic are the **original files**;
only the server transport changed (`google.script.run` → `fetch('/api')`) and the
Apps Script backend was reimplemented in Node.

## What maps to what

| Original (Apps Script)            | This project                                |
| --------------------------------- | ------------------------------------------- |
| `doGet()` + `include()`           | `server.js` (Express static + SPA fallback) |
| `apiRouter(json)` (Main.gs)       | `api/index.js`                              |
| `Config.gs`                       | `src/config.js`                             |
| `AuthService` (Service.gs)        | `src/services/auth.service.js`              |
| `DataService` (Service.gs)        | `src/services/data.service.js`              |
| `GeminiService` (Service.gs)      | `src/services/ai.service.js`                |
| Sync engine (Main.gs)             | `src/services/sync.service.js`              |
| `_supaFetch` / `_fetch`           | `src/services/supabase.js`                  |
| `CacheService` + `CACHE_TS`       | `src/services/cache.service.js`             |
| `Dashboard.html`                  | `public/index.html`                         |
| `Stylesheet.html`                 | `public/css/styles.css`                     |
| `Javascript*.html`                | `public/js/javascript*.js`                  |
| `PropertiesService`               | environment variables (`.env`)              |
| `SpreadsheetApp`                  | `googleapis` (service account)              |
| `UrlFetchApp`                     | `node-fetch`                                |

The Supabase views/tables, aggregation logic, RFM scoring, pareto cuts, KPI math
and API action names are preserved 1:1, so the dashboard renders identically.

## Setup

```bash
npm install
cp .env.example .env      # then fill in the values
npm run dev               # http://localhost:3000
```

### Required env (`.env`)

- `SUPABASE_URL`, `SUPABASE_KEY` — same project + service key used in the original
  Apps Script Script Properties. The app reads the same relations
  (`vw_monthly_agg`, `vw_hod_agg`, `vw_customer_summary`, `vw_customer_sale_agg`,
  `vw_sku_type_sale_agg`, `vw_brand_agg`, `vw_sku_agg`, `vw_outstanding_hod`,
  `target_master`, `user_profiles`, `rpc/get_filter_options`, …).

### Optional env

- `GEMINI_API_KEY` and/or `GROQ_API_KEY` — enable the AI Copilot / "Ask AI"
  (Gemini primary, Groq Llama-3 fallback). Without them the AI buttons return a
  clear "no API keys configured" message; everything else works.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — full service-account JSON (one line) for the
  **Settings → Sync** buttons (Append / Reset / Sync Outstanding / Sync Targets).
  Share each source sheet (RAW DATA, CUSTOMER MASTER, TARGET_DATA) with the
  service-account email. Read-only access is sufficient.

## Frontend build

`public/index.html`, `public/css/styles.css` and `public/js/javascript*.js` are
generated from the original Apps Script partials by:

```bash
node tools/build-frontend.js
```

This is only needed if you edit the original `../*.html` sources; the generated
files are committed and are the source of truth at runtime.

## Deployment

- **Node host (Render/Railway/VM):** `npm start` runs `server.js`.
- **Vercel:** `vercel.json` routes `/api*` to the serverless function and serves
  `public/` statically. Note: the resumable sheet-sync cursor is held in memory,
  so for very large `processAggregation` runs prefer a single long-lived Node
  process; the dashboard read endpoints are fully stateless.
