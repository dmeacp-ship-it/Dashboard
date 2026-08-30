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
  'BRANCH_NAME':       'branch_name',
  'BRANCH NAME':        'branch_name',
  'DATE':               'sale_date',
  'BILL_NUMBER_SAP':    'bill_number_sap',
  'BILL NUMBER SAP':    'bill_number_sap',
  'CUSTOMER_CODE':      'customer_code',
  'CUSTOMER CODE':      'customer_code',
  'CUSTOMER_NAME':      'customer_name',
  'CUSTOMER NAME':      'customer_name',
  'ITEM_CODE':          'item_code',
  'ITEM CODE':          'item_code',
  'ITEM_DESCRIPTION':   'item_description',
  'ITEM DESCRIPTION':   'item_description',
  'BATCH':              'batch',
  'THICKNESS':          'thickness',
  'THICKNESS_TYPE':     'thickness_type',
  'THICKNESS TYPE':     'thickness_type',
  'SIZE':               'size',
  'FINISH':             'finish',
  'BRAND':              'brand',
  'QUANTITY':           'quantity',
  'NET_REVENUE':        'net_revenue',
  'NET REVENUE':        'net_revenue',
  'REVENUE_WITH_GST':   'revenue_with_gst',
  'REVENUE WITH GST':   'revenue_with_gst',
  'TOTAL_SQM':          'total_sqm',
  'TOTAL SQM':          'total_sqm',
  'PROJECT%':           'project_pct',
  'PROJECT %':          'project_pct',
  'PROJECT_PCT':        'project_pct',
  'PROJECT PCT':        'project_pct',
  'PROJECT_SALES_PERSON': 'project_sales_person',
  'PROJECT SALES PERSON': 'project_sales_person',
  'COLOR_CODE':         'color_code',
  'COLOR CODE':         'color_code',
  'SALES_TYPE':         'sales_type',
  'SALES TYPE':         'sales_type',
  'PRODUCT_TYPE':       'product_type',
  'PRODUCT TYPE':       'product_type',
  'STATE':              'state',
  'CITY':               'city',
  'HOD_STATE':          'hod_state',
  'HOD STATE':          'hod_state',
  'ZONE':               'zone',
  'HOD_NAME':           'hod_name',
  'HOD NAME':           'hod_name',
  'SALES_PERSON_NAME':  'sales_person',
  'SALES PERSON NAME':  'sales_person',
  'ZONAL_HEAD':         'zonal_head',
  'ZONAL HEAD':         'zonal_head',
  'PREV._HOD_NAME':     'prev_hod_name',
  'PREV_HOD_NAME':      'prev_hod_name',
  'PREV. HOD NAME':     'prev_hod_name',
  'PREV HOD NAME':      'prev_hod_name',
  'SKU TYPE':           'sku_type',
  'SKU_TYPE':           'sku_type'
});

/* ------------------------------------------------------------------ */
/*  Units                                                              */
/* ------------------------------------------------------------------ */

/**
 * Square feet per square metre.
 *
 * The source sheets carry TOTAL_SQM only -- every sq ft figure in the app is
 * derived from it, both at sync time (sales_data.sq_ft) and again at display
 * time. This is the single definition; do not inline the number. The exact
 * value is 10.7639104167..., but the business standard here is 10.764 and the
 * database trigger (db/migrations/11_align_sqft_factor.sql) uses the same
 * constant so stored and recomputed values agree.
 */
const SQFT_PER_SQM = 10.764;

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
  MODEL:       'llama-3.1-70b-versatile',
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
  SQFT_PER_SQM,
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
