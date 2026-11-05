#!/usr/bin/env node
'use strict';

/*
 * HSS local development launcher (cross-platform; works in PowerShell, cmd, bash).
 *
 *   npm run dev          start the site on http://localhost:3000 using the local
 *                        working copy data/db.local.json (created on first run
 *                        from the live snapshot data/db.live.json)
 *   npm run dev:reset    throw away local edits: back up data/db.local.json and
 *                        recreate it from data/db.live.json (does not start)
 *
 * Safety:
 *   - DATABASE_URL is removed from the server's environment, so the server runs
 *     in JSON mode against data/db.local.json (never production Postgres). If a
 *     DATABASE_URL is also present in .env, server.js itself refuses to start
 *     outside production (see localSafetyProblems in server.js).
 *   - UPLOAD_STORAGE=local: admin image uploads go to public/uploads/, never to
 *     the production Supabase bucket.
 *   - data/db.json (committed demo data) and data/db.live.json (pristine
 *     snapshot) are never written.
 *   - Local admin login is the demo login from data/db.json (hssadmin / admin123),
 *     never the production one.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SNAPSHOT = path.join(ROOT, 'data', 'db.live.json');
const LOCAL = path.join(ROOT, 'data', 'db.local.json');
const DEMO = path.join(ROOT, 'data', 'db.json');

function log(msg) { console.log('[dev] ' + msg); }

/** Build the local working copy from the snapshot + demo admin login. Pure for testing. */
function buildLocalCopy(snapshot, demo) {
  const local = JSON.parse(JSON.stringify(snapshot));
  const admin = demo && demo.settings && demo.settings.admin;
  if (!admin || !admin.username || !admin.salt || !admin.passHash) {
    throw new Error('data/db.json has no demo admin login to copy.');
  }
  local.settings = local.settings || {};
  local.settings.admin = { username: admin.username, salt: admin.salt, passHash: admin.passHash };
  delete local.settings.sessionSecret;            // server.js generates a local one
  local._local = { createdAt: new Date().toISOString(), from: 'data/db.live.json',
    note: 'Local working copy. Safe to edit/delete; recreate with `npm run dev:reset`.' };
  return local;
}

function createLocalCopy() {
  if (!fs.existsSync(SNAPSHOT)) {
    throw new Error('data/db.live.json not found. Run `npm run export:catalog` first ' +
      '(reads the public live site; no credentials needed).');
  }
  if (fs.existsSync(LOCAL)) {
    const dir = path.join(ROOT, 'backups', 'db-local');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, 'db.local.' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.copyFileSync(LOCAL, dest);
    log('Backed up previous working copy to ' + path.relative(ROOT, dest));
  }
  const local = buildLocalCopy(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')), JSON.parse(fs.readFileSync(DEMO, 'utf8')));
  const tmp = LOCAL + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 2) + '\n');
  fs.renameSync(tmp, LOCAL);
  const exported = local._export && local._export.exportedAt;
  log(`Created data/db.local.json from snapshot${exported ? ' exported ' + exported : ''} ` +
    `(${(local.products || []).length} products, ${(local.categories || []).length} categories).`);
}

/** Environment for the local server process. Pure for testing. */
function devEnv(base = process.env) {
  const env = { ...base };
  delete env.DATABASE_URL;            // never production Postgres
  delete env.HSS_EXPORT_DATABASE_URL; // export-only credential, not for the server
  delete env.HSS_ALLOW_REMOTE_WRITES;
  delete env.RENDER;
  env.NODE_ENV = 'development';
  env.HSS_DATA_FILE = path.relative(ROOT, LOCAL);
  env.UPLOAD_STORAGE = 'local';
  env.PORT = base.PORT || '3000';
  return env;
}

/* On Windows a second server can appear to bind a port that an older process
   already holds, while the browser keeps talking to the OLD process (stale demo
   data). So refuse to start if anything already answers on the port. */
function portInUse(port) {
  return new Promise(resolve => {
    const sock = require('net').connect({ port: Number(port), host: '127.0.0.1' });
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

async function main(argv = process.argv.slice(2)) {
  const reset = argv.includes('--reset');
  if (reset || !fs.existsSync(LOCAL)) createLocalCopy();
  if (argv.includes('--no-start')) return;

  const env = devEnv();
  if (await portInUse(env.PORT)) {
    throw new Error(`Port ${env.PORT} is already in use — probably an older HSS server still running ` +
      '(it would keep serving stale data). Stop it (close its terminal, or in PowerShell: ' +
      `Get-NetTCPConnection -LocalPort ${env.PORT} -State Listen | % { Stop-Process -Id $_.OwningProcess }) ` +
      'or use another port: $env:PORT=3001; npm run dev');
  }
  spawnSync(process.execPath, [path.join(ROOT, 'stamp.js')], { cwd: ROOT, stdio: 'inherit' });
  log(`Starting on http://localhost:${env.PORT}  (data: ${env.HSS_DATA_FILE}, uploads: local, admin: hssadmin / admin123)`);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: 'inherit' });
  const stop = sig => { if (!child.killed) child.kill(sig); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  child.on('exit', code => process.exit(code === null ? 0 : code));
}

if (require.main === module) {
  main().catch(err => { console.error('[dev] ' + (err && err.message)); process.exit(1); });
}

module.exports = { buildLocalCopy, devEnv };
