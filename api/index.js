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
const { getSalesRowCount } = require('../src/services/supabase.js');
const { ROLES } = require('../src/config.js');

// ── Response envelopes (mirror _ok / _err) ──────────────────────────────────
function _ok(data) { return { ok: true, data: data, ts: Date.now() }; }
function _err(msg) { return { ok: false, error: String(msg), ts: Date.now() }; }

function _requireRole(profile, requiredRole) {
  if (profile.role !== requiredRole) throw new Error('ACCESS_DENIED: Action requires higher privileges.');
}

// Port of _applyScopeFilters from Main.gs.
function _applyScopeFilters(clientFilters, profile) {
  if (profile.role === ROLES.SUPER_ADMIN) return clientFilters;

  const scoped = {
    fy: clientFilters.fy || 'All',
    quarter: clientFilters.quarter || 'All',
    month: clientFilters.month || 'All',
    zone: 'All',
    state: 'All',
    _v: clientFilters._v || 1,
    _scope: {
      hod_name: profile.hod_name || null,
      allowed_states: profile.allowed_states || null,
      role: profile.role
    }
  };

  if (profile.role === ROLES.HOD) return scoped;

  if (profile.role === ROLES.STATE_MANAGER || profile.role === ROLES.VIEWER) {
    if (
      clientFilters.state &&
      clientFilters.state !== 'All' &&
      profile.allowed_states &&
      profile.allowed_states.indexOf(clientFilters.state) !== -1
    ) {
      scoped.state = clientFilters.state;
    }
    return scoped;
  }
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
    if (action === 'login') { res.json(_ok(await AuthService.login(req_.email, req_.password))); return; }
    if (action === 'logout') { res.json(_ok(await AuthService.logout())); return; }
    if (action === 'getProfile') { res.json(_ok(await AuthService.getProfile())); return; }
    if (action === 'clearServerCache') {
      const ts = String(Date.now());
      CacheService.invalidate();
      let dbRows = '0';
      try { dbRows = await getSalesRowCount(); } catch (e) { /* ignore */ }
      res.json(_ok({ cleared: true, ts: ts, dbRows: dbRows }));
      return;
    }

    // ── Secure endpoints ────────────────────────────────────────────────────
    const userProfile = await AuthService.requireAuth();
    const scopedFilters = _applyScopeFilters(req_.filters || {}, userProfile);

    // Admin-only: user management
    if (action === 'listUsers') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.listUsers())); return; }
    if (action === 'createUser') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.createUser(req_.userData))); return; }
    if (action === 'updateUser') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await AuthService.updateUser(req_.profileId, req_.userData))); return; }

    // Admin-only: sync actions
    if (action === 'processAggregation') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.processAggregation(req_.options || {}))); return; }
    if (action === 'syncOutstanding') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.syncOutstandingData())); return; }
    if (action === 'syncTargets') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SyncService.syncTargetData())); return; }

    // Settings
    if (action === 'getSettings') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SettingsService.getSettings())); return; }
    if (action === 'updateSettings') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await SettingsService.updateSettings(req_.configValue))); return; }
    if (action === 'getConnections') { _requireRole(userProfile, ROLES.SUPER_ADMIN); res.json(_ok(await ConnectionService.getAllConnections())); return; }
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
      getSkuTypeQoQ: () => DataService.getSkuTypeQoQ(scopedFilters),
      getSkuTypeMonthlySummary: () => DataService.getSkuTypeMonthlySummary(scopedFilters),
      getSkuTypeAllFYSummary: () => DataService.getSkuTypeAllFYSummary(scopedFilters),
      getExecutiveTargets: () => DataService.getExecutiveTargets(scopedFilters, opts),
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
      getTopSKUs: () => DataService.getTopSKUs(scopedFilters, opts)
    };

    if (!routes[action]) throw new Error('Unknown action routed: ' + action);
    res.json(_ok(await routes[action]()));
  } catch (err) {
    console.error('[apiRouter ERROR] Action: ' + (req_ ? req_.action : 'Unknown') + ' | ' + (err && err.stack ? err.stack : err));
    const status = (err.message || '').indexOf('ACCESS_DENIED') === 0 ? 403 : 500;
    res.status(status).json(_err(err.message || 'Internal server error'));
  }
};
