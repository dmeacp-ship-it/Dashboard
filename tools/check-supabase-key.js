/**
 * tools/check-supabase-key.js
 *
 * Tells you which Supabase key the backend is configured with, and whether it
 * is safe to run db/migrations/02_revoke_public_access.sql.
 *
 * Run:  node tools/check-supabase-key.js
 *
 * Background: Supabase issues two keys. The `anon` key is designed to be public
 * and is meant to be used from a browser, with Row Level Security doing the
 * protecting. The `service_role` key is a full-access backend credential that
 * bypasses RLS and must never leave your server.
 *
 * This dashboard's data lives largely in materialized views, which cannot have
 * RLS at all. So the anon key cannot be safely used here — the backend must use
 * service_role, and anon must be locked out.
 */

require('dotenv').config();

function decodeJwtRole(key) {
  const parts = String(key || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

const key = process.env.SUPABASE_KEY || '';
const url = process.env.SUPABASE_URL || '';

console.log('');
console.log('Supabase URL : ' + (url || '(not set)'));

if (!key) {
  console.log('Supabase key : (not set)');
  console.log('\nRESULT: SUPABASE_KEY is missing. Set it before going further.');
  process.exit(1);
}

const claims = decodeJwtRole(key);
if (!claims) {
  console.log('Supabase key : present, but not a readable JWT');
  console.log('\nRESULT: could not determine the key type. Check it in');
  console.log('        Supabase -> Project Settings -> API.');
  process.exit(1);
}

console.log('Key role     : ' + claims.role);
console.log('');

if (claims.role === 'service_role') {
  console.log('RESULT: SAFE.');
  console.log('  The backend uses the service_role key, so removing anon /');
  console.log('  authenticated / PUBLIC access will not affect the dashboard.');
  console.log('  You can run db/migrations/02_revoke_public_access.sql.');
  process.exit(0);
}

console.log('RESULT: DO NOT RUN THE REVOKE MIGRATION YET.');
console.log('');
console.log('  The backend is connecting with the "' + claims.role + '" key.');
console.log('  That is the same role the migration removes access from, so');
console.log('  running it now would break every dashboard query.');
console.log('');
console.log('  Fix first:');
console.log('   1. Supabase -> Project Settings -> API -> copy the');
console.log('      "service_role" secret key.');
console.log('   2. Put it in SUPABASE_KEY in .env (and in your Vercel project');
console.log('      environment variables, if deployed).');
console.log('   3. Restart the app and confirm the dashboard still loads.');
console.log('   4. Re-run this script. When it says SAFE, run the migration.');
process.exit(1);
