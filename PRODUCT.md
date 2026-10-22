# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Virgo ACP's own sales organisation, signed in with accounts kept in the `dashboard_users` table. Five roles: Super Admin and Admin see everything and run data syncs; a HOD sees only the HODs assigned to them; a Zonal Head sees only their zones; a Sales Viewer sees all sales but no outstanding data and no FMS.

## Product Purpose
One place to read the company's sales in square feet (by month, HOD, executive, customer, product and branch), against targets, next to what customers owe, and to see which customers need attention. The figures come from the company's Google Sheets, synced into Supabase. Success is a HOD or manager opening the dashboard and trusting the number without going back to the sheet.

## Positioning
An internal tool, shown in the app as "Virgo ACP · Intelligence Hub". It replaces an earlier Google Apps Script web app and keeps that app's pages and calculations.

## Operating Context
- Node / Express (`server.js`) locally or on a Node host; `vercel.json` also runs the API as a serverless function.
- Data: Google Sheets (RAW DATA per financial year, CUSTOMER MASTER for outstanding, TARGET_DATA) synced into Supabase. Pages read aggregate views and their materialized snapshots, never the raw table.
- Database changes are SQL files in `db/migrations/`, pasted into the Supabase SQL editor by hand. A file in the repo is not proof it was run; `db/health_check.sql` reports what is actually there.
- The browser loads minified assets built by `npm run minify`; the unminified files in `public/` are the source.
- Indian context: rupees and square feet in lakh / crore grouping, April-to-March financial years.

## Capabilities and Constraints

### Pages
- **Dashboard:** KPI cards, monthly trend, zone contribution, target vs sale.
- **Outstandings:** receivables by HOD and customer with 45 / 90 day ageing.
- **Target & Achievement:** HOD Target vs Sales, Executive Target vs Sales.
- **Sale Performance:** HOD, Executive, Project and Customer Sales by month, quarter or year.
- **Customer Health:** Top 80% Contributors, Customer Classification, Follow-up List.
- **Product Analysis:** Time-Wise Sales (by product type, SKU type, brand, branch, colour or thickness), HOD x SKU Analysis.
- **FMS:** live order, dispatch, production and stock views read from the OMS sheet.
- **User Activity** (admins): Usage by User, Login Log. **Settings**, **Data Sync**.

### Customer Health
- **Top 80% Contributors** also shows New Customers, Reactivated, Retention, Top-10 Share and Avg Order Size for the selected filters.
- **Customer Classification** places every customer in exactly one class of the chosen classification. Ten classifications: how often they buy (including three one-time classes), size, when they last bought, typical order size, trend, tenure, payment behaviour, retail vs project, product range, number of bills. A second classification can be crossed with the first; clicking a card or a cell lists those customers.
- **Follow-up List** gives each customer worth a call one reason (Stopped buying, Missed usual order, Buying less, One-time and never came back), ranked by monthly sq ft at stake, with outstanding and 90+ day dues alongside. "Missed usual order" is measured against the customer's own usual gap between purchases. Lost Territories (cities that bought last FY and not this FY) is its second tab.
- These three pages describe behaviour over all sales on record and ignore the FY / quarter / month filters. HOD and state filters and each user's access scope still apply.

### Constraints
- The unit is square feet, derived from square metres at 10.764 (`SQFT_PER_SQM`); revenue is carried but most pages do not show it.
- Customer-by-month data is the finest grain available, so "one-time", "usual gap" and "reactivated" are counted in months, not days. Number of bills is the only bill-level figure.
- As of 10 Oct 2026 the synced sales cover Apr-25 to Sep-26, so year-on-year customer figures have one earlier year to compare with.
- `color_code` and `prev_hod_name` are empty in every synced row. Colour is read from the item description instead; HOD handover analysis is not possible until the sheet fills that column.
- Branch names arrive in several spellings per depot and are merged on the server (`_branch`); the factory, the Lam depot and Virgo Aluminum are kept separate.
- Branch-wise sales and Avg Order Size need migration 19; the last three classifications need migration 20. Without them those options say so and everything else works.
- Role scope is enforced on the server. Known gap: a Zonal Head's scope is not applied on Customer Sales (confirmed on live data); Executive and Project Sales build their query the same way and are probably affected too.

### Refresh behaviour
- A new build makes open tabs reload themselves; filters and the open page are carried across that reload.
- Once an hour an open tab quietly reloads its current page without clearing the server's cache. The Refresh Cache button still clears it.

## Brand Commitments
- Name: Virgo ACP, subtitle Intelligence Hub. Light and dark themes.

## Evidence on Hand
- No user counts, testimonials or performance claims exist; never fabricate them.
- `tools/check-customer-insights.js` recounts the customer figures from the database and is the evidence that they reconcile.

## Product Principles
1. Every figure must reconcile with the source data; a number that cannot be checked is not shown.
2. Say what a figure means on the page that shows it (how a class is defined, what period it covers).
3. A user sees only what their role allows, decided on the server.
4. A missing optional view degrades one feature with a clear message, never the whole dashboard.

## Accessibility & Inclusion
No formal conformance target has been set. In place today: icon-only buttons carry labels, clickable cards are reachable and operable from the keyboard, and badge colours were adjusted for contrast in the light theme.
