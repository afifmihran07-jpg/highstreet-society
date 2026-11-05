'use strict';
/* Shared test harness: starts the real server.js on a throwaway copy of
   data/db.json (local uploads, no DATABASE_URL), returns small fetch helpers. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let portSeq = 4100 + (process.pid % 400);

async function startServer(extraEnv = {}, mutate = null) {
  const port = String(portSeq++);
  const dataFile = path.join(os.tmpdir(), `hss-test-${process.pid}-${crypto.randomBytes(3).toString('hex')}.json`);
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  if (mutate) mutate(seed);
  fs.writeFileSync(dataFile, JSON.stringify(seed));
  const env = { ...process.env, NODE_ENV: 'development', PORT: port, HSS_DATA_FILE: dataFile, UPLOAD_STORAGE: 'local', ...extraEnv };
  for (const k of ['DATABASE_URL', 'RENDER', 'HSS_ALLOW_REMOTE_WRITES', 'CORS_ORIGINS', 'TRUST_PROXY']) if (!(k in extraEnv)) delete env[k];
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
  let token = null;
  const json = async (p, { method = 'GET', body, headers = {}, admin = false } = {}) => {
    const h = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers };
    if (admin) h.Authorization = 'Bearer ' + (token || (token = await adminToken({ json })));
    const r = await fetch(base + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (_) {}
    return { status: r.status, data, headers: r.headers };
  };
  return { base, stop, json, dataFile, log: () => out };
}
async function adminToken(s, password = 'admin123') {
  const r = await s.json('/api/admin/login', { method: 'POST', body: { username: 'hssadmin', password } });
  return r.data && r.data.token;
}
module.exports = { startServer, adminToken, ROOT };
