# FILE 2 of 4 — RUN THIS SECOND (this one is NOT SQL)

**Do not skip this.** Running file 3 before finishing this will take the
dashboard offline.

## What's wrong

Supabase gives you two keys:

| Key | Meant for | Protected by |
| --- | --- | --- |
| `anon` | browsers / public clients | Row Level Security |
| `service_role` | your backend only | nothing — it has full access |

Your backend is currently connecting with the **`anon`** key.

That key is designed on the assumption that Row Level Security is doing the
protecting. But this dashboard reads most of its data from **materialized
views** (`mv_monthly_agg`, `mv_customer_summary`, …), and Postgres **cannot
apply Row Level Security to a materialized view at all**.

So right now the only thing standing between your full customer, revenue and
outstanding data and the open internet is that nobody outside the company has
seen the anon key. That key is the one Supabase documents as safe to paste into
client-side apps — so it is the kind of secret that tends to get shared.

The good news: I checked, and the anon key is **not** embedded anywhere in your
frontend bundle. The dashboard browser code only ever calls `/api`. So it has
not been handed out by the app itself.

## What to do

1. Go to **Supabase → Project Settings → API**.
2. Under *Project API keys*, copy the **`service_role`** key (the secret one —
   it will be marked as such, and Supabase will warn you to keep it private).
3. Open `.env` in the project root and replace the value of `SUPABASE_KEY`:

   ```
   SUPABASE_KEY=<paste the service_role key here>
   ```

4. **If the app is deployed to Vercel**, update it there too:
   Vercel → your project → Settings → Environment Variables → `SUPABASE_KEY`.
   Then redeploy.

5. Restart the app locally and confirm it still works:

   ```bash
   npm run dev
   ```

   Sign in, load Overview / Customers / Targets. Everything should behave
   exactly as before — `service_role` can do everything `anon` could, and more.

6. Confirm the swap took effect:

   ```bash
   node tools/check-supabase-key.js
   ```

   Keep going only once it prints **`RESULT: SAFE.`**

## Then

Run `03_revoke_public_access.sql`.

## A note on the Connections screen

If you have ever saved a connection through **Settings → Connections**, that
stored key overrides `.env`. Update it there as well, or clear it so the app
falls back to the environment variable.
