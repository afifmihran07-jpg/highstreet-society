'use strict';
/* Encoding regression guard. Two past commits (e28881b, dad0ad4) saved files
   through a Windows-1252 round-trip, turning "—" into "â€”" and the homepage
   loader "◌ Loading…" into "â—Œ Loadingâ€¦" — visible to every visitor on first
   paint. This test fails if that ever happens again.
   Run: node --test tests/encoding.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEXT = /\.(html|js|css|json|md|txt|sql|sh|py)$/i;
const SKIP = /node_modules|\.git[\\/]|backups[\\/]|tests[\\/]browser[\\/]artifacts|data[\\/]db\.(live|local|backup)\.json|package-lock\.json/;
// UTF-8 bytes of — → … • ৳ ◌ etc. mis-decoded as Windows-1252 / Latin-1
const MOJIBAKE = /â€[\u0080-›]?|â†|â—|Ã[\u0080-¿Œ-™]|Â[ -¿]|à§|ï»¿|�/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p + (e.isDirectory() ? path.sep : ''))) continue;
    if (e.isDirectory()) walk(p, out);
    else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(ROOT);

test('found the project text files', () => {
  assert.ok(files.length > 30, String(files.length));
});

test('no mojibake (double-encoded UTF-8) in any text file', () => {
  const hits = [];
  for (const f of files) {
    // these files contain the detection patterns / quote the old garbled text on purpose
    if (/encoding\.test\.js$|browser[\\/](flows|run)\.js$|PHASE1_STABILIZATION_REPORT\.md$/.test(f)) continue;
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const m = line.match(MOJIBAKE);
      if (m) hits.push(`${path.relative(ROOT, f)}:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('no UTF-8 byte-order marks (they break shebangs and robots.txt)', () => {
  const boms = files.filter(f => { const b = fs.readFileSync(f); return b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; });
  assert.deepEqual(boms.map(f => path.relative(ROOT, f)), []);
});

test('every HTML page declares UTF-8 within the first 1024 bytes', () => {
  const bad = files.filter(f => f.endsWith('.html')).filter(f =>
    !/<meta charset="utf-8">/i.test(fs.readFileSync(f, 'utf8').slice(0, 1024)));
  assert.deepEqual(bad.map(f => path.relative(ROOT, f)), []);
});

test('no font-dependent loading glyph in markup/scripts (renders as a box on some phones)', () => {
  const hits = files.filter(f => /public[\\/].*\.(html|js)$/.test(f) && /◌/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map(f => path.relative(ROOT, f)), []);
});
