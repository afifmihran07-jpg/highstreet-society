'use strict';
/* Integration tests for local-development safety guards in server.js and
   scripts/dev.js. Starts the real server on a temp copy of the data; never
   touches production, data/db.json, data/db.live.json or data/db.local.json.
   Run: node --test tests/local-safety.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { buildLocalCopy, devEnv } = require('../scripts/dev');

const ROOT = path.join(__dirname, '..');
const DEMO = path.join(ROOT, 'data', 'db.json');
const FAKE_REMOTE = 'postgresql://someone:TopSecretPw@db.example-prod.supabase.co:5432/postgres';

function baseEnv(extra = {}) {
  const env = { ...process.env, NODE_ENV: 'development', ...extra };
  for (const k of ['DATABASE_URL', 'RENDER', 'UPLOAD_STORAGE', 'HSS_ALLOW_REMOTE_WRITES', 'HSS_DATA_FILE']) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}

/** Start server.js; resolves when it is listening or has exited. */
function startServer(env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env });
    let out = '';
    const done = state => resolve({ child, out, ...state });
    child.stdout.on('data', d => { out += d; if (/HSS running/.test(out)) done({ listening: true }); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ listening: false, code }));
    setTimeout(() => done({ listening: false, code: 'timeout' }), 15000);
  });
}

function tempDataFile() {
  const f = path.join(os.tmpdir(), `hss-test-${process.pid}-${crypto.randomBytes(3).toString('hex')}.json`);
  fs.copyFileSync(DEMO, f);
  return f;
}

test('refuses a remote DATABASE_URL outside production, without leaking it', async () => {
  const r = await startServer(baseEnv({ DATABASE_URL: FAKE_REMOTE, PORT: '3921' }));
  assert.equal(r.listening, false);
  assert.equal(r.code, 1);
  assert.match(r.out, /DATABASE_URL points at a remote database/);
  assert.ok(!r.out.includes('TopSecretPw') && !r.out.includes('example-prod'), 'URL not printed');
});

test('refuses UPLOAD_STORAGE=supabase outside production', async () => {
  const r = await startServer(baseEnv({ UPLOAD_STORAGE: 'supabase', PORT: '3922', HSS_DATA_FILE: tempDataFile() }));
  assert.equal(r.listening, false);
  assert.match(r.out, /UPLOAD_STORAGE=supabase outside production/);
});

test('rejects an invalid UPLOAD_STORAGE value', async () => {
  const r = await startServer(baseEnv({ UPLOAD_STORAGE: 's3', PORT: '3923', HSS_DATA_FILE: tempDataFile() }));
  assert.equal(r.listening, false);
  assert.match(r.out, /UPLOAD_STORAGE must be/);
});

test('local mode: uses HSS_DATA_FILE, uploads to public/uploads, never Supabase', async t => {
  const dataFile = tempDataFile();
  const demoBefore = fs.readFileSync(DEMO);
  // Blank Supabase credentials: a Supabase call would fail loudly.
  const r = await startServer(baseEnv({ PORT: '3924', HSS_DATA_FILE: dataFile, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' }));
  t.after(() => { r.child.kill(); fs.rmSync(dataFile, { force: true }); });
  assert.equal(r.listening, true, r.out);
  assert.match(r.out, /uploads: local/);
  assert.match(r.out, new RegExp('data: .*' + path.basename(dataFile).replace(/\./g, '\\.')));

  const B = 'http://127.0.0.1:3924';
  const login = await fetch(B + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hssadmin', password: 'admin123' }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();

  // 1x1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'test.png');
  const up = await fetch(B + '/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
  const body = await up.json();
  assert.equal(up.status, 200, JSON.stringify(body));
  assert.equal(body.urls.length, 1);
  assert.match(body.urls[0], /^\/uploads\/[a-z0-9]+-[a-f0-9]{12}\.png$/);
  const saved = path.join(ROOT, 'public', body.urls[0]);
  t.after(() => fs.rmSync(saved, { force: true }));
  assert.ok(fs.existsSync(saved), 'file written locally');
  const served = await fetch(B + body.urls[0]);
  assert.equal(served.status, 200);

  // Writes went to the temp data file, not data/db.json.
  await fetch(B + '/api/products/her-exe/view', { method: 'POST' });
  assert.ok(fs.readFileSync(DEMO).equals(demoBefore), 'data/db.json unchanged');
});

test('dev.js: environment strips production credentials and forces local storage', () => {
  const env = devEnv({ DATABASE_URL: FAKE_REMOTE, HSS_EXPORT_DATABASE_URL: FAKE_REMOTE, RENDER: 'true',
    HSS_ALLOW_REMOTE_WRITES: '1', UPLOAD_STORAGE: 'supabase', PATH: 'x' });
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.HSS_EXPORT_DATABASE_URL, undefined);
  assert.equal(env.RENDER, undefined);
  assert.equal(env.HSS_ALLOW_REMOTE_WRITES, undefined);
  assert.equal(env.UPLOAD_STORAGE, 'local');
  assert.equal(env.NODE_ENV, 'development');
  assert.match(env.HSS_DATA_FILE, /db\.local\.json$/);
});

test('dev.js: local copy gets the demo admin login, never a production secret', () => {
  const demo = JSON.parse(fs.readFileSync(DEMO, 'utf8'));
  const snap = { settings: { admin: {}, sessionSecret: 'prod' }, products: [], categories: [] };
  const local = buildLocalCopy(snap, demo);
  assert.equal(local.settings.admin.username, demo.settings.admin.username);
  assert.equal(local.settings.sessionSecret, undefined);
  assert.deepEqual(snap.settings.admin, {}, 'snapshot object not mutated');
});

test('production (RENDER=true) behaviour is unchanged: Supabase uploads by default', async t => {
  const dataFile = tempDataFile();
  const r = await startServer(baseEnv({ RENDER: 'true', PORT: '3925', HSS_DATA_FILE: dataFile }));
  t.after(() => { r.child.kill(); fs.rmSync(dataFile, { force: true }); });
  assert.equal(r.listening, true, r.out);
  assert.match(r.out, /Environment: production \| uploads: supabase/);
});
