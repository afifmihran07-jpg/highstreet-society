'use strict';
/* Security regression tests (Phase 1 stabilisation). Each test starts the real
   server.js on a temporary copy of data/db.json. Run: node --test tests/security.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bd-geo.json'), 'utf8'));
let portSeq = 3960;

async function startServer(extraEnv = {}, mutate = null) {
  const port = String(portSeq++);
  const dataFile = path.join(os.tmpdir(), `hss-sec-${process.pid}-${crypto.randomBytes(3).toString('hex')}.json`);
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  if (mutate) mutate(seed);
  fs.writeFileSync(dataFile, JSON.stringify(seed));
  const env = { ...process.env, NODE_ENV: 'development', PORT: port, HSS_DATA_FILE: dataFile, UPLOAD_STORAGE: 'local', ...extraEnv };
  for (const k of ['DATABASE_URL', 'RENDER', 'HSS_ALLOW_REMOTE_WRITES', 'CORS_ORIGINS']) if (!(k in extraEnv)) delete env[k];
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env });
  let out = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; if (/HSS running/.test(out)) resolve(); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', c => reject(new Error('exited ' + c + ' ' + out)));
    setTimeout(() => reject(new Error('timeout ' + out)), 15000);
  });
  const base = 'http://127.0.0.1:' + port;
  const stop = () => { child.kill(); fs.rmSync(dataFile, { force: true }); };
  const json = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data, headers: r.headers };
  };
  return { base, stop, json, dataFile };
}
async function adminToken(s, password = 'admin123') {
  const r = await s.json('/api/admin/login', { method: 'POST', body: { username: 'hssadmin', password } });
  return r.data && r.data.token;
}

test('CORS: no credentialed access for arbitrary origins; allow-list works', async t => {
  const s = await startServer({ CORS_ORIGINS: 'https://trusted.example' });
  t.after(s.stop);
  const evil = await fetch(s.base + '/api/settings', { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.equal(evil.headers.get('access-control-allow-credentials'), null);
  const nul = await fetch(s.base + '/api/admin/orders', { headers: { Origin: 'null' } });
  assert.equal(nul.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(s.base + '/api/admin/orders', { method: 'OPTIONS', headers: { Origin: 'https://evil.example',
    'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const ok = await fetch(s.base + '/api/settings', { headers: { Origin: 'https://trusted.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://trusted.example');
});

test('cookies are SameSite=Lax + HttpOnly; security headers present', async t => {
  const s = await startServer();
  t.after(s.stop);
  const r = await fetch(s.base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hssadmin', password: 'admin123' }) });
  const cookies = r.headers.getSetCookie();
  assert.ok(cookies.length >= 2);
  for (const c of cookies) { assert.match(c, /SameSite=Lax/); assert.match(c, /HttpOnly/); assert.doesNotMatch(c, /SameSite=None/); }
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.headers.get('referrer-policy'));
});

test('session tokens are not accepted from the URL', async t => {
  const s = await startServer();
  t.after(s.stop);
  const tok = await adminToken(s);
  assert.equal((await s.json('/api/admin/me?__t=' + encodeURIComponent(tok))).status, 401);
  assert.equal((await s.json('/api/admin/me', { headers: { Authorization: 'Bearer ' + tok } })).status, 200);
});

test('changing the admin password invalidates all earlier admin tokens', async t => {
  const s = await startServer();
  t.after(s.stop);
  const a = await adminToken(s), b = await adminToken(s);
  const H = tok => ({ Authorization: 'Bearer ' + tok });
  const ch = await s.json('/api/admin/password', { method: 'POST', headers: H(a),
    body: { currentPassword: 'admin123', newPassword: 'newsecret99' } });
  assert.equal(ch.status, 200);
  assert.equal((await s.json('/api/admin/me', { headers: H(b) })).status, 401, 'other session ended');
  assert.equal((await s.json('/api/admin/me', { headers: H(a) })).status, 401, 'own old token ended');
  const c = await adminToken(s, 'newsecret99');
  assert.equal((await s.json('/api/admin/me', { headers: H(c) })).status, 200);
});

test('password reset: no token from /forgot; admin code works once; old sessions end', async t => {
  const s = await startServer();
  t.after(s.stop);
  const mobile = '01911' + String(Date.now()).slice(-6);
  const reg = await s.json('/api/auth/register', { method: 'POST', body: { name: 'Sec Test', mobile, password: 'oldpass' } });
  assert.equal(reg.status, 200);
  const custTok = reg.data.token;
  const f = await s.json('/api/auth/forgot', { method: 'POST', body: { mobile } });
  assert.equal(f.status, 200);
  assert.ok(!('resetToken' in f.data), 'no reset token handed to anonymous callers');
  // legacy token-only reset is gone
  assert.equal((await s.json('/api/auth/reset', { method: 'POST', body: { resetToken: 'x.y', password: 'hacked' } })).status, 400);
  // customers cannot mint codes
  const custList = await s.json('/api/admin/customers', { headers: { Authorization: 'Bearer ' + custTok } });
  assert.equal(custList.status, 401);
  const at = await adminToken(s);
  const id = (await s.json('/api/admin/customers', { headers: { Authorization: 'Bearer ' + at } })).data.customers.find(c => c.mobile === mobile).id;
  const rc = await s.json(`/api/admin/customers/${id}/reset-code`, { method: 'POST', headers: { Authorization: 'Bearer ' + at } });
  assert.match(rc.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(rc.data.whatsappUrl, /^https:\/\/wa\.me\/8801\d{9}\?text=/);
  assert.equal((await s.json('/api/auth/reset', { method: 'POST', body: { mobile, code: 'ZZZZ-ZZZZ', password: 'newpass' } })).status, 400);
  const ok = await s.json('/api/auth/reset', { method: 'POST', body: { mobile, code: rc.data.code, password: 'newpass' } });
  assert.equal(ok.status, 200);
  assert.equal((await s.json('/api/auth/reset', { method: 'POST', body: { mobile, code: rc.data.code, password: 'again' } })).status, 400, 'single use');
  assert.equal((await s.json('/api/auth/me', { headers: { Authorization: 'Bearer ' + custTok } })).status, 401, 'old session ended');
  assert.equal((await s.json('/api/auth/me', { headers: { Authorization: 'Bearer ' + ok.data.token } })).status, 200);
});

test('requests without a JSON body get 400, not a 500 crash', async t => {
  const s = await startServer();
  t.after(s.stop);
  for (const p of ['/api/products/her-exe/reviews', '/api/auth/register', '/api/auth/login', '/api/orders', '/api/auth/reset']) {
    const r = await fetch(s.base + p, { method: 'POST' });
    assert.ok(r.status >= 400 && r.status < 500, `${p} -> ${r.status}`);
  }
});

test('rate limiting: repeated admin logins get 429', async t => {
  const s = await startServer();
  t.after(s.stop);
  let last;
  for (let i = 0; i < 11; i++) last = await s.json('/api/admin/login', { method: 'POST', body: { username: 'x', password: 'y' } });
  assert.equal(last.status, 429);
});

test('orders: duplicate cart lines are merged before the stock check', async t => {
  let p;
  const s = await startServer({}, db => {
    p = db.products.find(x => x.published && !(x.sizes || []).length && !x.allowBackorder);
    p.stock = 12;     // two lines of 8 = 16 > 12 (each line alone passed before the fix)
  });
  t.after(s.stop);
  const dist = GEO.find(d => d.name === 'Dhaka').districts.find(d => d.name === 'Dhaka');
  const body = { name: 'Dup Test', mobile: '01712345678', division: 'Dhaka', district: 'Dhaka', area: dist.areas[0],
    address: 'House 1, Road 2, Test', paymentMethod: 'cod', items: [{ id: p.id, qty: 8 }, { id: p.id, qty: 8 }] };
  const r = await s.json('/api/orders', { method: 'POST', body });
  assert.equal(r.status, 400, 'combined qty 16 > stock ' + p.stock);
  assert.match(r.data.error, /only has/);
  const over = await s.json('/api/orders', { method: 'POST', body: { ...body, items: [{ id: p.id, qty: 15 }, { id: p.id, qty: 15 }] } });
  assert.equal(over.status, 400, 'more than 20 of one set is refused, not silently reduced');
  assert.match(over.data.error, /at most 20/);
  const ok = await s.json('/api/orders', { method: 'POST', body: { ...body, items: [{ id: p.id, qty: 1 }, { id: p.id, qty: 2 }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.order.items.length, 1);
  assert.equal(ok.data.order.items[0].qty, 3);
});

test('uploads: extension comes from the validated type, not the filename', async t => {
  const s = await startServer();
  t.after(s.stop);
  const tok = await adminToken(s);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('images', new Blob([png], { type: 'image/png' }), 'evil.html');
  const r = await fetch(s.base + '/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: form });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.match(d.urls[0], /\.png$/);
  fs.rmSync(path.join(ROOT, 'public', d.urls[0]), { force: true });
  const bad = new FormData();
  bad.append('images', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
  const r2 = await fetch(s.base + '/api/admin/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: bad });
  assert.equal(r2.status, 400);
});

/* SEC-1: client IP behind Cloudflare -> Render. The test client connects from
   loopback (playing the Render load balancer); X-Forwarded-For is built the way
   the real chain builds it: <whatever the visitor sent>, <visitor IP added by
   Cloudflare>, <Cloudflare edge IP added by Render>. */
const CF_EDGE = '172.64.0.5';
const viaChain = (spoofed, real) => ({ 'X-Forwarded-For': [spoofed, real, CF_EDGE].filter(Boolean).join(', ') });
const badLogin = (s, headers) => s.json('/api/admin/login', { method: 'POST', body: { username: 'x', password: 'y' }, headers });

test('SEC-1: rotating spoofed X-Forwarded-For entries does not escape the login rate limit', async t => {
  const s = await startServer();
  t.after(s.stop);
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await badLogin(s, viaChain(`10.9.8.${i}, 1.2.3.${i}`, '203.0.113.9'))).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
  assert.deepEqual(codes.slice(10), [429, 429], codes.join(' '));
});

test('SEC-1: legitimate visitors behind the same proxies keep separate limits; client IP is the real one', async t => {
  const s = await startServer();
  t.after(s.stop);
  for (let i = 0; i < 11; i++) await badLogin(s, viaChain(null, '198.51.100.1'));
  assert.equal((await badLogin(s, viaChain(null, '198.51.100.1'))).status, 429, 'visitor A is limited');
  assert.equal((await badLogin(s, viaChain(null, '198.51.100.2'))).status, 401, 'visitor B is not affected by A');
  // IPv6 visitor + Cloudflare IPv6 edge
  const v6 = { 'X-Forwarded-For': '2001:db8::77, 2606:4700::1' };
  const login = await s.json('/api/admin/login', { method: 'POST', body: { username: 'hssadmin', password: 'admin123' }, headers: v6 });
  assert.equal(login.status, 200);
  const who = await s.json('/api/admin/client-ip', { headers: { Authorization: 'Bearer ' + login.data.token, ...viaChain('6.6.6.6', '203.0.113.50') } });
  assert.equal(who.status, 200);
  assert.equal(who.data.ip, '203.0.113.50', 'spoofed 6.6.6.6 must be ignored');
  assert.equal((await s.json('/api/admin/client-ip')).status, 401, 'diagnostic is admin-only');
});

test('SEC-1: TRUST_PROXY override; "true" is refused as spoofable', async t => {
  const s = await startServer({ TRUST_PROXY: 'false' });
  t.after(s.stop);
  const tok = await adminToken(s);
  const who = await s.json('/api/admin/client-ip', { headers: { Authorization: 'Bearer ' + tok, ...viaChain('6.6.6.6', '203.0.113.50') } });
  assert.match(who.data.ip, /127\.0\.0\.1/);
  const s2 = await startServer({ TRUST_PROXY: 'true' });
  t.after(s2.stop);
  const tok2 = await adminToken(s2);
  const who2 = await s2.json('/api/admin/client-ip', { headers: { Authorization: 'Bearer ' + tok2, ...viaChain('6.6.6.6', '203.0.113.50') } });
  assert.equal(who2.data.ip, '203.0.113.50');
});
