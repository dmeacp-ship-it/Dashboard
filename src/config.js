/**
 * src/config.js — Central configuration module
 *
 * Mirrors the original Google Apps Script Config.gs but exported as
 * a CommonJS module for Node.js / Vercel serverless.
 *
 * All objects are frozen to prevent accidental mutation at runtime.
 */

/* ------------------------------------------------------------------ */
/*  Google Sheets source configuration                                 */
/* ------------------------------------------------------------------ */

const SOURCE_SHEETS = Object.freeze([
  { id: '16W8RjcIXi2RkriB3b-toTlJU2Go1rw1ksZDoMV96dpg', fy: 'FY 24-25' },
  { id: '1LdqfThBo3LXgI9NFlRS9w0xTDMOImoj9YYnbieZ-J7k', fy: 'FY 25-26' },
  { id: '1i8DLTpUOk6JoOld6sfFj6Q0C_2BzXF5D9JpXSvedpDk', fy: 'FY 26-27' }
]);

const CONFIG = Object.freeze({
  SOURCE_SHEETS,
  RAW_SHEET_NAME: 'RAW DATA',
  CACHE_TTL: 21600,   // 6 hours in seconds
  BATCH_SIZE: 5000
});

/* ------------------------------------------------------------------ */
/*  Column mapping — sheet header → DB column                          */
/* ------------------------------------------------------------------ */

const COLUMN_MAP = Object.freeze({
  'BRANCH NAME':      'branch_name',
  'DATE':             'sale_date',
  'CUSTOMER CODE':    'customer_code',
  'CUSTOMER NAME':    'customer_name',
  'ITEM CODE':        'item_code',
  'ITEM DESCRIPTION': 'item_description',
  'BATCH':            'batch',
  'THICKNESS':        'thickness',
  'THICKNESS TYPE':   'thickness_type',
  'SIZE':             'size',
  'FINISH':           'finish',
  'BRAND':            'brand',
  'QUANTITY':         'quantity',
  'NET REVENUE':      'net_revenue',
  'REVENUE WITH GST': 'revenue_with_gst',
  'TOTAL SQM':        'total_sqm',
  'SQ FT.':           'sq_ft',
  'SALES TYPE':       'sales_type',
  'FY YEAR':          'fy_year',
  'QUARTER':          'quarter',
  'MONTH YEAR':       'month_year',
  'LENGTH (MM)':      'length_mm',
  'WIDTH (MM)':       'width_mm',
  'PRODUCT TYPE':     'product_type',
  'SKU TYPE':         'sku_type',
  'ZONE':             'zone',
  'STATE':            'state',
  'HOD NAME':         'hod_name',
  'SALES PERSON NAME':'sales_person',
  'ZONAL HEAD':       'zonal_head'
});

/* ------------------------------------------------------------------ */
/*  Database tables                                                    */
/* ------------------------------------------------------------------ */

const DB_TABLES = Object.freeze({
  SALES:       'sales_data',
  PROFILES:    'user_profiles',
  OUTSTANDING: 'outstanding_master',
  TARGETS:     'target_master'
});

/* ------------------------------------------------------------------ */
/*  User roles                                                         */
/* ------------------------------------------------------------------ */

const ROLES = Object.freeze({
  SUPER_ADMIN:   'super_admin',
  ADMIN:         'admin',
  HOD:           'hod',
  ZONAL_HEAD:    'zonal_head',
  STATE_MANAGER: 'state_manager',
  VIEWER:        'viewer'
});

/* ------------------------------------------------------------------ */
/*  AI provider configs                                                */
/* ------------------------------------------------------------------ */

const GEMINI_CONFIG = Object.freeze({
  MODEL:       'gemini-2.5-flash',
  API_BASE:    'https://generativelanguage.googleapis.com/v1beta/models/',
  CACHE_TTL:   21600,
  MAX_TOKENS:  1500,
  TEMPERATURE: 0.1,
  MAX_RETRIES: 2,
  RETRY_DELAY: 3000
});

const GROQ_CONFIG = Object.freeze({
  MODEL:       'llama3-70b-8192',
  API_BASE:    'https://api.groq.com/openai/v1/chat/completions',
  MAX_TOKENS:  1500,
  TEMPERATURE: 0.1
});

/* ------------------------------------------------------------------ */
/*  Sync configuration                                                 */
/* ------------------------------------------------------------------ */

const SYNC_CONFIG = Object.freeze({
  BATCH_SIZE:  5000,
  TABLE_NAME:  DB_TABLES.SALES
});

/* ------------------------------------------------------------------ */
/*  Outstanding / Customer master                                      */
/* ------------------------------------------------------------------ */

const OUTSTANDING_CONFIG = Object.freeze({
  SHEET_ID:         '1wpaZwEqW6AHGYqz-4Lm0CEoMQbWIefTa12wMQ_87K_8',
  SHEET_NAME:       'CUSTOMER MASTER',
  TABLE_NAME:       'outstanding_master',
  SYNC_EVERY_HOURS: 2
});

const OUTSTANDING_COLUMN_MAP = Object.freeze({
  'CUSTOMER CODE':            'customer_code',
  'DEALER / CUSTOMER NAME':   'customer_name',
  'CONTACT PERSON':           'contact_person',
  'MOBILE':                   'mobile',
  'EMAIL':                    'email',
  'ADDRESS':                  'address',
  'PAYMENT TERM':             'payment_term',
  'CREDIT LIMIT (₹)':        'credit_limit',
  'CURRENT OUTSTANDING (₹)': 'current_outstanding',
  'BELOW 45 DAYS (₹)':       'below_45_days',
  'ABOVE 45 DAYS (₹)':       'above_45_days',
  '90+ DAYS (₹)':            'days_90_plus',
  'LAST UPDATED':             'last_updated_src',
  'NOTES':                    'notes'
});

/* ------------------------------------------------------------------ */
/*  Target configuration                                               */
/* ------------------------------------------------------------------ */

const TARGET_CONFIG = Object.freeze({
  SHEET_ID:   '1aJomY8qL1cVJrUgmQU7VsAfwsda4FMNoyIgDUKlH-Zw',
  SHEET_NAME: 'TARGET_DATA',
  TABLE_NAME: DB_TABLES.TARGETS
});

const TARGET_COLUMN_MAP = Object.freeze({
  'Employee Name':    'employee_name',
  'Financial Year':   'fy_year',
  'Month':            'month_name',
  'Zone':             'zone',
  'State':            'state',
  'HOD Name':         'hod_name',
  'Designation':      'designation',
  'Base Location':    'base_location',
  'Target (Sq. Ft.)': 'target_sqft',
  'Achivement':       'achievement',
  'Remarks':          'remarks'
});

/* ------------------------------------------------------------------ */
/*  Environment helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns the Supabase project URL from env vars.
 * @returns {string}
 */
function getSupabaseUrl() {
  const ConnectionService = require('./services/connection.service');
  const conn = ConnectionService.getActiveConnection();
  if (!conn || !conn.url) throw new Error('Missing Supabase URL config');
  return conn.url;
}

/**
 * Returns the Supabase anon/service key from env vars.
 * @returns {string}
 */
function getSupabaseKey() {
  const ConnectionService = require('./services/connection.service');
  const conn = ConnectionService.getActiveConnection();
  if (!conn || !conn.key) throw new Error('Missing Supabase Key config');
  return conn.key;
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = {
  CONFIG,
  SOURCE_SHEETS,
  COLUMN_MAP,
  DB_TABLES,
  ROLES,
  GEMINI_CONFIG,
  GROQ_CONFIG,
  SYNC_CONFIG,
  OUTSTANDING_CONFIG,
  OUTSTANDING_COLUMN_MAP,
  TARGET_CONFIG,
  TARGET_COLUMN_MAP,
  getSupabaseUrl,
  getSupabaseKey
};
