const { supaFetch } = require('./supabase');

async function getSettings() {
  const res = await supaFetch('/rest/v1/app_settings?id=eq.google_sheets', 'get');
  if (res && res.length > 0) {
    return res[0].config_value;
  }
  // Return null if not configured yet
  return null;
}

async function updateSettings(configValue) {
  // Use POST with upsert to create or update the settings row
  // We can't pass 'Prefer: resolution=merge-duplicates' easily via supaFetch without modifying it,
  // but if the row is guaranteed to exist via the user's SQL script, a PATCH works perfectly.
  return supaFetch(
    '/rest/v1/app_settings?id=eq.google_sheets',
    'patch',
    { config_value: configValue, updated_at: new Date().toISOString() }
  );
}

module.exports = {
  getSettings,
  updateSettings
};
