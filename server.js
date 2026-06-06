/**
 * server.js — Local development Express server
 *
 * Mirrors the Vercel serverless routing so you can develop locally
 * without running `vercel dev`.
 *
 * Usage:  npm run dev
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/*  Middleware                                                         */
/* ------------------------------------------------------------------ */

// CORS — wide-open for local dev, Vercel handles production headers
app.use(cors());

// Parse JSON bodies (Vercel does this automatically for serverless fns)
app.use(express.json({ limit: '10mb' }));

// Serve the public/ folder as static assets
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/*  API route — adapts the Vercel handler for Express                  */
/* ------------------------------------------------------------------ */

const apiHandler = require('./api/index.js');

/**
 * Wrap the Vercel-style handler (req, res) so it works with Express.
 * Vercel handlers rely on `res.status().json()` which Express also
 * supports, so the adapter is thin.
 */
app.all('/api', async (req, res) => {
  try {
    await apiHandler(req, res);
  } catch (err) {
    console.error('[server] Unhandled error in /api handler:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.all('/api/*', async (req, res) => {
  try {
    await apiHandler(req, res);
  } catch (err) {
    console.error('[server] Unhandled error in /api/* handler:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

/* ------------------------------------------------------------------ */
/*  SPA fallback — any non-API, non-static request gets index.html     */
/* ------------------------------------------------------------------ */

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log(`[server] Virgo ACP Dashboard running → http://localhost:${PORT}`);
  console.log(`[server] API endpoint             → http://localhost:${PORT}/api`);
});
