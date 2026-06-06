/**
 * tools/build-frontend.js
 *
 * One-shot build step that turns the original Google Apps Script HTML
 * partials (Dashboard.html, Stylesheet.html, Javascript*.html) into plain
 * static assets under public/, changing ONLY:
 *   1. <?!= include('X'); ?>  ->  <link>/<script> tags
 *   2. window.api()'s google.script.run transport -> fetch('/api')
 *
 * Everything else (markup, CSS, JS logic) is preserved byte-for-byte so the
 * Node version renders identically to the Apps Script original.
 *
 * Run:  node tools/build-frontend.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..');            // ...\APPS
const PUB = path.resolve(__dirname, '..', 'public');         // ...\APPS\Dashboard\public

function read(file) {
  let s = fs.readFileSync(path.join(SRC, file), 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  return s;
}

function stripWrapper(s, tag) {
  // remove the first <tag ...> and the last </tag>
  const open = new RegExp('^[\\s\\S]*?<' + tag + '[^>]*>\\r?\\n?', 'i');
  const close = new RegExp('\\r?\\n?</' + tag + '>\\s*$', 'i');
  return s.replace(open, '').replace(close, '');
}

// ---------------------------------------------------------------------------
// 1. Stylesheet.html -> public/css/styles.css
// ---------------------------------------------------------------------------
const css = stripWrapper(read('Stylesheet.html'), 'style');
fs.mkdirSync(path.join(PUB, 'css'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'css', 'styles.css'), css, 'utf8');

// ---------------------------------------------------------------------------
// 2. Javascript.html -> public/js/javascript.js  (+ transport patch)
// ---------------------------------------------------------------------------
let js0 = stripWrapper(read('Javascript.html'), 'script');

// Replace the google.script.run based window.api with a fetch based one.
// Anchor on the exact original block.
const API_START = 'window.api = function(action, extra) {';
const startIdx = js0.indexOf(API_START);
if (startIdx === -1) throw new Error('Could not locate window.api in Javascript.html');
// find the terminating "};\n" that closes the function (the apiRouter line + 2 closers)
const ANCHOR = '.apiRouter(JSON.stringify(payload));';
const anchorIdx = js0.indexOf(ANCHOR, startIdx);
if (anchorIdx === -1) throw new Error('Could not locate apiRouter call in window.api');
const endIdx = js0.indexOf('};', anchorIdx) + 2;

const NEW_API = [
  'window.api = function(action, extra) {',
  '  extra = extra || {};',
  '  var payload = Object.assign({ action: action, filters: window.App.filters }, extra);',
  "  return fetch('/api', {",
  "    method: 'POST',",
  "    headers: { 'Content-Type': 'application/json' },",
  '    body: JSON.stringify(payload)',
  '  })',
  '  .then(function(resp) {',
  '    return resp.text().then(function(txt) {',
  '      var r;',
  '      try { r = txt ? JSON.parse(txt) : {}; }',
  "      catch(e) { throw new Error('Parse error: ' + e.message); }",
  '      if (r.ok) return r.data;',
  "      throw new Error(r.error || ('Server error on action: ' + action));",
  '    });',
  '  });',
  '};'
].join('\n');

js0 = js0.slice(0, startIdx) + NEW_API + js0.slice(endIdx);
fs.mkdirSync(path.join(PUB, 'js'), { recursive: true });
fs.writeFileSync(path.join(PUB, 'js', 'javascript.js'), js0, 'utf8');

// ---------------------------------------------------------------------------
// 3. Javascript1.html / Javascript2.html -> public/js/*.js  (verbatim)
// ---------------------------------------------------------------------------
fs.writeFileSync(path.join(PUB, 'js', 'javascript1.js'), stripWrapper(read('Javascript1.html'), 'script'), 'utf8');
fs.writeFileSync(path.join(PUB, 'js', 'javascript2.js'), stripWrapper(read('Javascript2.html'), 'script'), 'utf8');

// ---------------------------------------------------------------------------
// 4. Dashboard.html -> public/index.html  (resolve include() tags)
// ---------------------------------------------------------------------------
let html = read('Dashboard.html');
html = html
  .replace(/<\?!=\s*include\('Stylesheet'\);?\s*\?>/, '<link rel="stylesheet" href="/css/styles.css"/>')
  .replace(/<\?!=\s*include\('JavaScript'\);?\s*\?>/,  '<script src="/js/javascript.js"></script>')
  .replace(/<\?!=\s*include\('JavaScript1'\);?\s*\?>/, '<script src="/js/javascript1.js"></script>')
  .replace(/<\?!=\s*include\('JavaScript2'\);?\s*\?>/, '<script src="/js/javascript2.js"></script>');
fs.writeFileSync(path.join(PUB, 'index.html'), html, 'utf8');

console.log('Frontend built:');
['css/styles.css', 'js/javascript.js', 'js/javascript1.js', 'js/javascript2.js', 'index.html']
  .forEach(f => console.log('  public/' + f + '  (' + fs.statSync(path.join(PUB, f)).size + ' bytes)'));
