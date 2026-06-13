/**
 * tools/minify-frontend.js
 *
 * Post-build step. Minifies the JS/CSS assets that index.html actually loads
 * and rewrites the <script>/<link> tags to point at the minified files with a
 * content-hash cache-buster.
 *
 * The frontend scripts are plain globals that rely on execution order
 * (window.App, window.api, ...), so each file is minified INDIVIDUALLY — we do
 * not bundle/tree-shake, which would risk load-order bugs.
 *
 * Idempotent: it always derives the .min file from the unminified source and
 * rewrites whichever form (foo.js / foo.min.js, with or without ?v=) is present.
 *
 * Run:  node tools/minify-frontend.js   (or `npm run build`, which chains it)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const PUB = path.resolve(__dirname, '..', 'public');

// Assets index.html loads, relative to public/. Source -> minified.
const JS = ['js/javascript.js', 'js/javascript1.js', 'js/javascript2.js', 'js/fms.js'];
const CSS = ['css/styles.css', 'css/fms.css'];

function minFile(rel, loader) {
  const src = path.join(PUB, rel);
  if (!fs.existsSync(src)) { console.warn('  skip (missing): ' + rel); return null; }
  const code = fs.readFileSync(src, 'utf8');
  const out = esbuild.transformSync(code, { loader, minify: true, legalComments: 'none' });
  const minRel = rel.replace(/\.(js|css)$/, '.min.$1');
  fs.writeFileSync(path.join(PUB, minRel), out.code, 'utf8');
  const hash = crypto.createHash('sha1').update(out.code).digest('hex').slice(0, 8);
  const before = Buffer.byteLength(code), after = Buffer.byteLength(out.code);
  console.log(`  ${rel} -> ${minRel}  (${before} -> ${after} bytes, -${Math.round((1 - after / before) * 100)}%)`);
  return { rel, minRel, hash };
}

console.log('Minifying frontend assets:');
const results = [...JS.map(f => minFile(f, 'js')), ...CSS.map(f => minFile(f, 'css'))].filter(Boolean);

// Rewrite index.html tags. For each asset, match /path/name(.min)?.(js|css)(?v=...)?
let html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
for (const { rel, minRel, hash } of results) {
  const base = rel.replace(/\.(js|css)$/, '');          // e.g. js/javascript
  const ext = rel.split('.').pop();                      // js | css
  const re = new RegExp('/' + base.replace(/[/]/g, '\\/') + '(?:\\.min)?\\.' + ext + '(?:\\?v=[^"\']*)?', 'g');
  html = html.replace(re, '/' + minRel + '?v=' + hash);
}
fs.writeFileSync(path.join(PUB, 'index.html'), html, 'utf8');
console.log('index.html rewritten to load minified assets.');
