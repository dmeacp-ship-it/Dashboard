/**
 * tools/check-customer-insights.js
 *
 * Read-only check: recounts the Customer Insights cards (new customers,
 * retention) straight from the customer sale view and compares them with what
 * getCustomerInsights returns. Also checks that Branch-wise sales merges the
 * depot spellings without losing volume, and that Customer Classification puts
 * every customer in exactly one class. Run from the project root:
 *
 *   node tools/check-customer-insights.js
 */
require('dotenv').config();
const assert = require('assert');
const { fetchAll } = require('../src/services/supabase');
const DataService = require('../src/services/data.service');

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sk(monthYear) {
  const p = String(monthYear).replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  return '20' + p[1].slice(-2) + '-' + String(MN.indexOf(p[0].slice(0, 3)) + 1).padStart(2, '0');
}
function fyStart(k) { return +k.slice(5) >= 4 ? +k.slice(0, 4) : +k.slice(0, 4) - 1; }

(async function () {
  await DataService.loadHodStates(true);
  const got = await DataService.getCustomerInsights({});

  const by = {}; let cur = '';
  (await fetchAll('vw_customer_sale_agg', '?select=customer_code,month_year,total_sqm')).forEach(function (r) {
    if (!(Number(r.total_sqm) > 0)) return;
    const k = sk(r.month_year);
    (by[r.customer_code] = by[r.customer_code] || new Set()).add(k);
    if (k > cur) cur = k;
  });
  const want = { buyersMonth: 0, newMonth: 0, newFy: 0, retentionBase: 0, retained: 0 };
  Object.keys(by).forEach(function (c) {
    const months = Array.from(by[c]).sort();
    const inFy = function (y) { return months.some(function (k) { return fyStart(k) === y; }); };
    if (by[c].has(cur)) want.buyersMonth++;
    if (months[0] === cur) want.newMonth++;
    if (fyStart(months[0]) === fyStart(cur)) want.newFy++;
    if (inFy(fyStart(cur) - 1)) { want.retentionBase++; if (inFy(fyStart(cur))) want.retained++; }
  });

  Object.keys(want).forEach(function (k) { assert.strictEqual(got[k], want[k], k); });
  console.log('OK', got.month, JSON.stringify(want));

  const pivot = function (g) { return DataService.getProductPivotSales({}, { timeGroup: 'year', rowGroup: g }); };
  const total = function (p) { return p.rows.reduce(function (s, r) { return s + r.TOTAL_SQFT; }, 0); };
  const branch = await pivot('branch_name');
  const names = branch.rows.map(function (r) { return r.CATEGORY.toUpperCase(); });
  assert.strictEqual(new Set(names).size, names.length, 'duplicate branch names');
  assert.ok(!names.some(function (n) { return /ACP INDUSTR/.test(n); }), 'depot spellings not merged');
  assert.ok(Math.abs(total(branch) - total(await pivot('brand'))) < 100, 'branch total differs from brand total');
  console.log('OK branches', branch.rows.length);

  const customers = Object.keys(by).length;
  const oneTime = Object.keys(by).filter(function (c) { return by[c].size === 1; }).length;
  const first = await DataService.getCustomerClassification({}, { cross: 'size' }, false);
  assert.strictEqual(first.totalCustomers, customers, 'classification customer count');
  for (const d of first.dims.filter(function (x) { return x.available; })) {
    const r = await DataService.getCustomerClassification({}, { by: d.key }, false);
    assert.strictEqual(r.classes.reduce(function (s, c) { return s + c.count; }, 0), customers, d.key + ' classes do not cover every customer once');
  }
  assert.strictEqual(first.classes.filter(function (c) { return c.name.indexOf('One-time') === 0; })
    .reduce(function (s, c) { return s + c.count; }, 0), oneTime, 'one-time buyers');
  assert.strictEqual(first.matrix.reduce(function (s, row) { return s + row.reduce(function (a, e) { return a + e.count; }, 0); }, 0), customers, 'cross table total');
  const follow = await DataService.getFollowUpList({}, {}, false);
  assert.strictEqual(follow.reasons.reduce(function (s, r) { return s + r.count; }, 0), follow.allCount, 'follow-up reasons');
  console.log('OK classification', customers, 'customers,', oneTime, 'one-time,', follow.allCount, 'follow-ups');
  process.exit(0);
})().catch(function (e) { console.error('FAIL', e.message); process.exit(1); });
