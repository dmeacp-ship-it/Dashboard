/**
 * api/index.js — HTTP entry point (Vercel serverless / Express adapter)
 *
 * Faithful port of apiRouter(json) from Main.gs. A single POST /api endpoint
 * receives { action, filters, options, ... } and returns the standard
 * { ok, data, ts } / { ok:false, error, ts } envelope.
 *
 * Like the original, authentication resolves to a fixed bypass super-admin
 * profile (AuthService.requireAuth), so scope filtering is unrestricted.
 */

const AuthService = require('../src/services/auth.service.js');
const DataService = require('../src/services/data.service.js');
const SyncService = require('../src/services/sync.service.js');
const AIService = require('../src/services/ai.service.js');
const CacheService = require('../src/services/cache.service.js');
const SettingsService = require('../src/services/settings.service.js');
const ConnectionService = require('../src/services/connection.service.js');
const FmsService = require('../src/services/fms.service.js');
const UsersService = require('../src/services/users.service.js');
const RateLimit = require('../src/services/ratelimit.js');
const { getSalesRowCount } = require('../src/services/supabase.js');
const { ROLES } = require('../src/config.js');

// Login throttle: 8 attempts per username+IP per 15 minutes. Cleared on a
// successful sign-in so a legitimate user who mistypes isn't punished.
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LEN = 8;

// ── Response envelopes (mirror _ok / _err) ──────────────────────────────────
function _ok(data) { return { ok: true, data: data, ts: Date.now() }; }
function _err(msg) { return { ok: false, error: String(msg), ts: Date.now() }; }

function _requireRole(profile, requiredRole) {
  if (profile.role !== requiredRole) throw new Error('ACCESS_DENIED: Action requires higher privileges.');
}

// Client errors carry an explicit status so the catch block doesn't report a
// bad request or a failed sign-in as a 500.
function _bad(msg, status) {
  const e = new Error(msg);
  e.status = status || 400;
  return e;
}

// Applies role-based data scoping. super_admin & admin are unrestricted; hod is
// locked to its allowed_hods (one or more HOD names); zonal_head to its
// allowed_zones. The restriction rides along in _scope so the data layer can
// add the matching `hod_name=in.(…)` / `zone=in.(…)` filters.
function _applyScopeFilters(clientFilters, profile) {
  const f = clientFilters || {};
  if (profile.role === ROLES.SUPER_ADMIN || profile.role === ROLES.ADMIN) return f;

  const scoped = Object.assign({}, f, { _scope: { role: profile.role } });

  if (profile.role === ROLES.HOD) {
    const hods = (profile.allowed_hods && profile.allowed_hods.length) ? profile.allowed_hods : ['__none__'];
    scoped._scope.allowed_hods = hods;
    scoped.hod = 'All'; // the scope restriction supersedes any client hod filter
    return scoped;
  }

  if (profile.role === ROLES.ZONAL_HEAD) {
    const zones = (profile.allowed_zones && profile.allowed_zones.length) ? profile.allowed_zones : ['__none__'];
    scoped._scope.allowed_zones = zones;
    scoped.zone = 'All';
    return scoped;
  }

  // legacy roles (state_manager / viewer) keep the old state scoping
  scoped._scope.allowed_states = profile.allowed_states || null;
  return scoped;
}

function _setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

module.exports = async function handler(req, res) {
  _setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json(_err('Method not allowed. Use POST.')); return; }

  let req_;
  try {
    req_ = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = req_.action;

    // ── Open endpoints ──────────────────────────────────────────────────────
    if (action === 'login') {
      const rlKey = 'login:' + String(req_.username || '').toLowerCase().trim() + ':' + RateLimit.clientIp(req);
      const gate = RateLimit.hit(rlKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
      if (!gate.allowed) {
        res.setHeader('Retry-After', String(gate.retryAfterSec));
        res.status(429).json(_err('Too many sign-in attempts. Try again in ' +
          Math.ceil(gate.retryAfterSec / 60) + ' minute(s).'));
        return;
      }
      const result = await AuthService.login(req_.username, req_.password);
      RateLimit.reset(rlKey);
      res.json(_ok(result));
      return;
    }
    if (action === 'logout') { res.json(_ok(await AuthService.logout())); return; }
    if (action === 'getProfile') { res.json(_ok(await AuthService.getProfile(req_.token))); return; }
    if (action === 'clearServerCache') {
      const ts = String(Date.now());
      CacheService.invalidate();
      let dbRows = '0';
      try { dbRows = await getSalesRowCount(); } catch (e) { /* ignore */ }
      res.json(_ok({ cleared: true, ts: ts, dbRows: dbRows }));
      return;
    }

    // ── Secure endpoints ────────────────────────────────────────────────────
    const userProfile = await AuthService.requireAuth(req_.token);
    // Warm the hod_name -> HOD-territory map before anything reads or filters
    // on state; it is memoised for 10 minutes, so this is a no-op on all but
    // the first request after a cold start or a sync.
    await DataService.loadHodStates();
    const scopedFilters = _applyScopeFilters(req_.filters || {}, userProfile);

    // Admin-only: user management (super admin)
    if (action === 'listUsers') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.listUsers())); return; }
    if (action === 'createUser') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.createUser(req_.userData))); return; }
    if (action === 'updateUser') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.updateUser(req_.profileId, req_.userData))); return; }
    if (action === 'deleteUser') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.deleteUser(req_.profileId))); return; }
    
    // User self-serve. Requires the current password: a session token alone
    // must not be enough to take permanent ownership of an account.
    if (action === 'updateMyPassword') {
      const newPw = String(req_.newPassword || '');
      if (newPw.length < MIN_PASSWORD_LEN) {
        throw _bad('New password must be at least ' + MIN_PASSWORD_LEN + ' characters.');
      }
      if (!req_.currentPassword) throw _bad('Enter your current password to change it.');
      const ok = await UsersService.verifyCurrentPassword(userProfile.id, req_.currentPassword);
      // 400, not 401: the frontend force-logs-out on any 401, and a mistyped
      // current password must not eject the user out of the form.
      if (!ok) throw _bad('Current password is incorrect.');
      res.json(_ok(await AuthService.updateUser(userProfile.id, { password: newPw })));
      return;
    }

    // Admin-only: sync actions
    if (action === 'processAggregation') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.processAggregation(req_.options || {}))); return; }
    if (action === 'syncOutstanding') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.syncOutstandingData())); return; }
    if (action === 'syncTargets') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.syncTargetData())); return; }

    // Settings
    if (action === 'getSettings') { res.json(_ok(await SettingsService.getSettings())); return; }
    if (action === 'updateSettings') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SettingsService.updateSettings(req_.configValue))); return; }
    if (action === 'getConnections') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await ConnectionService.getAllConnectionsMasked())); return; }
    if (action === 'updateConnections') { _requireRole(userProfile, ROLES.SUPER_ADMIN); await ConnectionService.saveConnections(req_.connectionData); res.json(_ok(true)); return; }

    // AI integrations
    if (action === 'askTable') { res.json(_ok(await AIService.askTable(req_.tableData, req_.question))); return; }
    if (action === 'askCopilot') { res.json(_ok(await AIService.askCopilot(req_.contextName, req_.contextData, req_.question))); return; }
    // Standard data endpoints
    const opts = req_.options || {};
    const routes = {
      getFilterOptions: () => DataService.getFilterOptions(userProfile),
      getKPIs: () => DataService.getKPIs(scopedFilters),
      getOverviewData: () => DataService.getOverviewData(scopedFilters),
      getMonthlySummary: () => DataService.getMonthlySummary(scopedFilters),
      getStateSummary: () => DataService.getStateSummary(scopedFilters),
      getHODQoQ: () => DataService.getHODQoQ(scopedFilters),
      getHODMonthlySummary: () => DataService.getHODMonthlySummary(scopedFilters),
      getHODAllFYSummary: () => DataService.getHODAllFYSummary(scopedFilters),
      getCustomerQoQ: () => DataService.getCustomerQoQ(scopedFilters),
      getCustomerMonthlySummary: () => DataService.getCustomerMonthlySummary(scopedFilters),
      getCustomerAllFYSummary: () => DataService.getCustomerAllFYSummary(scopedFilters),
      getExecutiveQoQ: () => DataService.getExecutiveQoQ(scopedFilters),
      getExecutiveMonthlySummary: () => DataService.getExecutiveMonthlySummary(scopedFilters),
      getExecutiveAllFYSummary: () => DataService.getExecutiveAllFYSummary(scopedFilters),
      getProjectQoQ: () => DataService.getProjectQoQ(scopedFilters),
      getProjectMonthlySummary: () => DataService.getProjectMonthlySummary(scopedFilters),
      getProjectAllFYSummary: () => DataService.getProjectAllFYSummary(scopedFilters),
      getSkuTypeQoQ: () => DataService.getSkuTypeQoQ(scopedFilters),
      getSkuTypeMonthlySummary: () => DataService.getSkuTypeMonthlySummary(scopedFilters),
      getSkuTypeAllFYSummary: () => DataService.getSkuTypeAllFYSummary(scopedFilters),
      getExecutiveTargets: () => DataService.getExecutiveTargets(scopedFilters, opts),
      getTargetVsAchievement: () => DataService.getTargetVsAchievement(scopedFilters, opts),
      getOutstandingSummary: () => DataService.getOutstandingSummary(scopedFilters),
      getOutstandingHODSummary: () => DataService.getOutstandingHODSummary(scopedFilters),
      getOutstandingStateSummary: () => DataService.getOutstandingStateSummary(scopedFilters),
      getTopCustomers: () => DataService.getTopCustomers(scopedFilters, opts),
      getInactiveCustomers: () => DataService.getInactiveCustomers(scopedFilters, opts),
      getDecliningCustomers: () => DataService.getDecliningCustomers(scopedFilters, opts),
      getLostHVCustomers: () => DataService.getLostHVCustomers(scopedFilters, opts),
      getRFMData: () => DataService.getRFMData(scopedFilters, opts),
      getRFMDistribution: () => DataService.getRFMDistribution(scopedFilters),
      getBrandSummary: () => DataService.getBrandSummary(scopedFilters),
      getFinishSummary: () => DataService.getFinishSummary(scopedFilters),
      getProductTypeSummary: () => DataService.getProductTypeSummary(scopedFilters),
      getDimensionalSummary: () => DataService.getDimensionalSummary(scopedFilters),
      getCategoricalPerformance: () => DataService.getCategoricalPerformance(scopedFilters, opts),
      getTimeWiseSales: () => DataService.getTimeWiseSales(scopedFilters, opts),
      getProductPivotSales: () => DataService.getProductPivotSales(scopedFilters, opts),
      getHodSkuPivotSales: () => DataService.getHodSkuPivotSales(scopedFilters, opts),
      getTopSKUs: () => DataService.getTopSKUs(scopedFilters, opts),
      getCustomReport: () => DataService.getCustomReport(opts),
      getSheetHeaders: () => DataService.getSheetHeaders(opts),
      getSheetTabs: () => DataService.getSheetTabs(opts),

      // ── FMS / OMS live sheet tables ──────────────────────────────────────
      getFmsTable: () => FmsService.getFmsTable(opts, null),
      listFmsTables: () => FmsService.listFmsTables(),
      getFmsOrders: () => FmsService.getFmsOrders(opts, null),
      getFmsDashboard: () => FmsService.getFmsDashboard(null),
      getFmsOrderDetail: () => FmsService.getFmsOrderDetail(opts, null),
      getFmsPartySummary: () => FmsService.getFmsPartySummary(null),
      getFmsMonthWise: () => FmsService.getFmsMonthWise(null),
      getFmsDelivery: () => FmsService.getFmsDelivery(null),
      getFmsPlantItems: () => FmsService.getFmsPlantItems(null),
      getItems: () => FmsService.getItems()
    };

    if (!routes[action]) throw new Error('Unknown action routed: ' + action);
    res.json(_ok(await routes[action]()));
  } catch (err) {
    const m = (err && err.message) || '';
    const status = (err && err.status) ? err.status
      : m.indexOf('ACCESS_DENIED') === 0 ? 403
        : (m.indexOf('AUTH_REQUIRED') === 0 || m.indexOf('SESSION') === 0) ? 401
          : /^Invalid username or password\.$/.test(m) ? 401
            : /^(Username and password are required|Account is disabled)/.test(m) ? 400
              : 500;
    // 401/403 are routine (expired token, wrong role) — log one line. Only a
    // genuine 5xx warrants a stack trace.
    const label = '[apiRouter ' + status + '] Action: ' + (req_ ? req_.action : 'Unknown');
    if (status === 500) console.error(label + ' | ' + (err && err.stack ? err.stack : err));
    else console.warn(label + ' | ' + m);
    res.status(status).json(_err(m || 'Internal server error'));
  }
};
