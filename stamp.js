#!/usr/bin/env node
/* Cache-busting stamper.
   Rewrites /js/*.js and /css/*.css references in public/*.html to include
   ?v=<content-hash>. Because the hash changes whenever the file changes,
   browsers are forced to fetch updated code instead of serving a stale
   copy from disk cache — while unchanged files stay cacheable. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUB = path.join(__dirname, 'public');
const hash = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);

const ver = {};
for (const dir of ['js', 'css']) {
  const d = path.join(PUB, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (/\.(js|css)$/.test(f)) ver[f] = hash(path.join(d, f));
  }
}

let changed = 0;
for (const f of fs.readdirSync(PUB)) {
  if (!f.endsWith('.html')) continue;
  const fp = path.join(PUB, f);
  const before = fs.readFileSync(fp, 'utf8');
  const after = before
    .replace(/(src=")(\/js\/[^"?]+)(\?v=[^"]*)?(")/g, (m, a, p, q, z) => {
      const base = path.basename(p);
      return ver[base] ? `${a}${p}?v=${ver[base]}${z}` : m;
    })
    .replace(/(href=")(\/css\/[^"?]+)(\?v=[^"]*)?(")/g, (m, a, p, q, z) => {
      const base = path.basename(p);
      return ver[base] ? `${a}${p}?v=${ver[base]}${z}` : m;
    });
  if (after !== before) { fs.writeFileSync(fp, after); changed++; }
}
console.log(`stamped ${changed} html file(s):`, ver);
