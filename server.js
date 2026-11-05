#!/usr/bin/env node
require('dotenv').config();
/* Highstreet Society — E-commerce backend (Express + file DB) */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const compression = require('compression');
const zlib = require('zlib');
const { initialize: initializePersistence, persistState } = require('./db-postgres');
/* ---------------- environment & local-development safety ----------------
   Render sets RENDER=true on every service; NODE_ENV=production is the
   generic signal for any other host. Production behaviour is unchanged:
   uploads go to Supabase Storage and DATABASE_URL is honoured.
   Anywhere else (a developer machine) the server refuses to write to remote
   production resources unless HSS_ALLOW_REMOTE_WRITES=1 is set explicitly. */
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const ALLOW_REMOTE_WRITES = process.env.HSS_ALLOW_REMOTE_WRITES === '1';
// Where admin product-image uploads go: 'supabase' (production default) or
// 'local' (public/uploads — default everywhere else).
const UPLOAD_STORAGE = String(process.env.UPLOAD_STORAGE || (IS_PRODUCTION ? 'supabase' : 'local')).toLowerCase();
const SUPABASE_BUCKET = 'product-images';
let supabase = null;
function getSupabase() {
  if (!supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      throw new Error('Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing)');
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  }
  return supabase;
}
function isLocalDatabaseUrl(url) {
  try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname); }
  catch (_) { return false; }
}
/* Returns a list of fatal configuration problems (never includes secret values). */
function localSafetyProblems() {
  const problems = [];
  if (!['local', 'supabase'].includes(UPLOAD_STORAGE)) {
    problems.push(`UPLOAD_STORAGE must be "local" or "supabase" (got "${UPLOAD_STORAGE}").`);
  }
  if (IS_PRODUCTION || ALLOW_REMOTE_WRITES) return problems;
  if (process.env.DATABASE_URL && !isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    problems.push('DATABASE_URL points at a remote database, but this is not a production environment. ' +
      'Local runs must not write to production. Remove DATABASE_URL (use the JSON snapshot via `npm run dev`), ' +
      'point it at a local Postgres, or set HSS_ALLOW_REMOTE_WRITES=1 if you really intend this.');
  }
  if (UPLOAD_STORAGE === 'supabase') {
    problems.push('UPLOAD_STORAGE=supabase outside production would upload into the production bucket. ' +
      'Use UPLOAD_STORAGE=local, or set HSS_ALLOW_REMOTE_WRITES=1 if you really intend this.');
  }
  return problems;
}

const app = express();
const PORT = process.env.PORT || 3000;
// HSS_DATA_FILE lets local development use its own working copy (e.g.
// data/db.local.json) instead of the committed demo data/db.json.
const DB_PATH = process.env.HSS_DATA_FILE
  ? path.resolve(__dirname, process.env.HSS_DATA_FILE)
  : path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(__dirname,'public','uploads');
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
const GEO = JSON.parse(fs.readFileSync(path.join(__dirname,'data','bd-geo.json'),'utf8'));
const GEO_JSON = JSON.stringify(GEO);
const GEO_GZ = zlib.gzipSync(Buffer.from(GEO_JSON));
const GEO_ETAG = '"geo-'+crypto.createHash('md5').update(GEO_JSON).digest('hex').slice(0,16)+'"';
const DISTRICTS = {};
GEO.forEach(d=>d.districts.forEach(t=>{ DISTRICTS[t.name.toLowerCase()] = { division:d.name, areas:new Set(t.areas.map(a=>a.toLowerCase())) }; }));

app.set('trust proxy', true);

/* CORS — allow-list only.
   The storefront and admin are served from the same origin as the API, so
   they need no CORS at all. Previously this reflected ANY Origin (including
   "null") with Allow-Credentials, which let any website read authenticated
   API responses (admin orders, customer data) from a logged-in browser.
   Extra trusted origins can be listed in CORS_ORIGINS (comma-separated). */
const CORS_ORIGINS = new Set(String(process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean));
app.use((req,res,next)=>{
  const origin = req.headers.origin;
  if(origin) res.setHeader('Vary', 'Origin');
  if(origin && CORS_ORIGINS.has(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-HSS-Refresh');
    res.setHeader('Access-Control-Expose-Headers', 'X-HSS-New-Token');
    res.setHeader('Access-Control-Max-Age', '0');   // never cache preflights
  }
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* Baseline security headers. (No CSP yet: the pages rely on inline scripts and
   inline event handlers — see docs/PHASE1_STABILIZATION_REPORT.md.) */
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if(isSecureReq(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(compression());
app.use(express.json({ limit: '2mb' }));
// Express 5 leaves req.body undefined when a request has no JSON body; many
// handlers read req.body.x directly and crashed with a 500 instead of a 400.
app.use((req,res,next)=>{ if(req.body === undefined) req.body = {}; next(); });
app.disable('x-powered-by');

/* Small in-memory rate limiter for abuse-prone endpoints (login, reset,
   register, orders, reviews). Per-process and per client IP; good enough for
   a single Render instance. */
const RATE = new Map();
function rateLimit(name, max, windowMs, keyFn = req => req.ip){
  return (req,res,next)=>{
    const key = name + '|' + keyFn(req);
    const now = Date.now();
    let e = RATE.get(key);
    if(!e || e.reset <= now){ e = { count:0, reset: now + windowMs }; RATE.set(key, e); }
    e.count++;
    if(e.count > max){
      res.setHeader('Retry-After', Math.ceil((e.reset - now)/1000));
      return res.status(429).json({ error:'Too many attempts. Please wait a few minutes and try again.' });
    }
    if(RATE.size > 20000){ for(const [k,v] of RATE) if(v.reset <= now) RATE.delete(k); }
    next();
  };
}

/* ---------------- DB ---------------- */
let db;
let persistence = { mode:'json', pool:null };
let saveTail = Promise.resolve();

function normalizeLocalDB(raw) {
  db = raw || {};
  db.meta = db.meta || {};
  db.sessions = db.sessions || {};
  db.reviews = db.reviews || [];
  db.carts = db.carts || [];
  db.content = db.content || {};
  db.customers = db.customers || [];
  db.designs = db.designs || [];
  db.revoked = db.revoked || {};
  db.meta.orderSeq = db.meta.orderSeq || 1001;
  db.meta.productSeq = db.meta.productSeq || 180;
  db.meta.customerSeq = db.meta.customerSeq || 1;
  db.meta.designSeq = db.meta.designSeq || 1001;
  db.customers.forEach(c=>{
    if(c.address  === undefined) c.address  = '';
    if(c.area     === undefined) c.area     = '';
    if(c.division === undefined) c.division = '';
    if(c.district === undefined) c.district = '';
    if(c.locality === undefined) c.locality = '';
    if(c.landmark === undefined) c.landmark = '';
  });
  return db;
}

function saveDB() {
  if(persistence.mode === 'json') {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
    return Promise.resolve();
  }
  // Snapshot now, then serialize PostgreSQL writes. This prevents two
  // synchronous request mutations in this Node process from overwriting each
  // other while retaining the existing db-object API used throughout server.js.
  const snapshot = JSON.parse(JSON.stringify(db));
  const job = saveTail.then(() => persistState(persistence.pool, snapshot));
  saveTail = job.catch(err => { console.error('[postgres save]', err && err.stack ? err.stack : err); });
  return job;
}

async function initializePersistenceLayer() {
  const result = await initializePersistence({ jsonPath:DB_PATH });
  persistence = { mode:result.mode, pool:result.pool };
  db = normalizeLocalDB(result.db);
  if(result.migration && result.migration.imported) {
    console.log('[hss] Imported db.json into PostgreSQL:', result.migration.counts);
  }
  console.log('[hss] Persistence mode:', persistence.mode);
}

/* ---------------- helpers ---------------- */
const uid = (p='') => p + crypto.randomBytes(8).toString('hex');
const slugify = s => String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || ('item-'+Date.now().toString(36));
function hash(pw, salt){ return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function effPrice(p){ return (p.salePrice && p.salePrice < p.price) ? p.salePrice : p.price; }
function pubProduct(p){
  return { id:p.id, slug:p.slug, setNo:p.setNo, name:p.name, short:p.short, description:p.description,
    price:p.price, salePrice:p.salePrice, effPrice: effPrice(p),
    discountPct: (p.salePrice && p.salePrice < p.price) ? Math.round((1-p.salePrice/p.price)*100) : 0,
    stock:p.stock, sku:p.sku, categoryIds:p.categoryIds, tags:p.tags, cover:p.cover, posters:p.posters,
    featured:p.featured, isNew:p.isNew, bestseller:p.bestseller, published:p.published,
    allowBackorder:!!p.allowBackorder, inStock: p.stock > 0 || !!p.allowBackorder,
    type:p.type||'poster', sizes:p.sizes||[], bundleItems:p.bundleItems||[],
    posterSize:p.posterSize||'A4', boardThickness:p.boardThickness||'3mm',
    sold:p.sold||0, views:p.views||0, sort:p.sort||0, seoTitle:p.seoTitle||'', seoDesc:p.seoDesc||'',
    createdAt:p.createdAt, updatedAt:p.updatedAt };
}
/* Cookie helpers — a second, storage-independent way to carry the session.
   The preview runs inside a sandboxed iframe where localStorage throws, so
   auth must also survive via an HttpOnly cookie. */
/* ---------------- stateless session tokens ----------------
   Sessions used to live only in db.sessions (process memory + a JSON file).
   That breaks on any multi-instance / serverless host (Vercel, autoscaling),
   where the login request and the next /api/admin/me can land on DIFFERENT
   instances: the second one has never seen the token and returns 401, which
   bounces a successful login straight back to a cleared login form.

   Tokens are now self-contained and HMAC-signed, so ANY instance can verify
   them without shared state. db.sessions is still honoured for older tokens
   and is used as a revocation list on logout. */
let SESSION_SECRET = '';
function initializeSessionSecret() {
  if (process.env.SESSION_SECRET) {
    SESSION_SECRET = process.env.SESSION_SECRET;
    return;
  }
  if (db.settings && db.settings.sessionSecret) {
    SESSION_SECRET = db.settings.sessionSecret;
    return;
  }
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  // Keep the generated secret in the persistent settings object so a local
  // JSON fallback does not silently invalidate every session on restart.
  db.settings = db.settings || {};
  db.settings.sessionSecret = SESSION_SECRET;
}
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64uDec = s => Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString();
const SESSION_TTL_MS = 30*24*60*60*1000;

function signToken(payload){
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  return body + '.' + sig;
}
function verifyToken(tok){
  if(typeof tok !== 'string' || tok.indexOf('.') < 0) return null;
  const [body, sig] = tok.split('.');
  if(!body || !sig) return null;
  const expect = b64u(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  // constant-time compare
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if(a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
  let data;
  try{ data = JSON.parse(b64uDec(body)); }catch(e){ return null; }
  if(!data || !data.t || !data.iat) return null;
  if(Date.now() - data.iat > SESSION_TTL_MS) return null;
  return data;
}
/* Password-bound tokens. Each token carries `pv`, a fingerprint of the
   account's CURRENT password hash. Changing a password therefore invalidates
   every token issued before — previously stateless tokens stayed valid for
   30 days after a password change, despite "logs out all sessions".
   Admin tokens must carry a matching pv; customer tokens issued before this
   change (no pv) stay valid until they expire. */
function pvFor(type, id){
  let ph = null;
  if(type === 'admin') ph = db.settings && db.settings.admin && db.settings.admin.passHash;
  else if(type === 'customer'){ const c = db.customers.find(x => x.id === id); ph = c && c.passHash; }
  if(!ph) return '';
  return crypto.createHmac('sha256', SESSION_SECRET).update('pv|' + type + '|' + ph).digest('hex').slice(0, 16);
}
function tokenCurrent(cl){
  if(!cl) return false;
  if(cl.t === 'admin' || cl.t === 'admin-refresh') return !!cl.pv && cl.pv === pvFor('admin', 'admin');
  if(cl.t === 'customer') return !cl.pv || cl.pv === pvFor('customer', cl.id);
  return true;
}
/* db.sessions (bookkeeping) and db.revoked grew forever — one row per login /
   renewal / logout — and the whole db is held in memory and cloned on every
   save. Entries older than the token lifetime are useless (verifyToken rejects
   such tokens anyway), so drop them, at most once an hour. */
let lastSessionPrune = 0;
function pruneSessions(){
  const now = Date.now();
  if(now - lastSessionPrune < 60*60*1000) return;
  lastSessionPrune = now;
  for(const [t, s] of Object.entries(db.sessions || {})) if(!s || now - (s.createdAt || 0) > SESSION_TTL_MS) delete db.sessions[t];
  for(const [t, at] of Object.entries(db.revoked || {})) if(now - (at || 0) > SESSION_TTL_MS) delete db.revoked[t];
}
function issueSession(type, id){
  pruneSessions();
  const token = signToken({ t:type, id, iat:Date.now(), n:crypto.randomBytes(6).toString('hex'), pv:pvFor(type, id) });
  db.sessions[token] = { type, id, createdAt: Date.now() };   // legacy/bookkeeping
  return token;
}
function issueAdminRefresh(){
  return signToken({ t:'admin-refresh', id:'admin', iat:Date.now(), n:crypto.randomBytes(6).toString('hex'), pv:pvFor('admin','admin') });
}

function parseCookies(req){
  const out = {};
  const raw = req.headers.cookie;
  if(!raw) return out;
  raw.split(';').forEach(part=>{
    const i = part.indexOf('=');
    if(i < 0) return;
    const k = part.slice(0,i).trim();
    if(!k) return;
    try{ out[k] = decodeURIComponent(part.slice(i+1).trim()); }
    catch(e){ out[k] = part.slice(i+1).trim(); }
  });
  return out;
}
function isSecureReq(req){
  return req.secure || String(req.headers['x-forwarded-proto']||'').split(',')[0].trim() === 'https';
}
function setSessionCookie(req,res,name,token){
  // SameSite=Lax: the cookie is not sent on cross-site requests, which (with
  // the CORS allow-list) blocks CSRF / cross-site reads. It used to be
  // SameSite=None for an old cross-origin preview iframe.
  const secure = isSecureReq(req);
  const attrs = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'Max-Age='+(60*60*24*30), 'SameSite=Lax'
  ];
  if(secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}
function clearSessionCookie(req,res,name){
  const secure = isSecureReq(req);
  const attrs = [`${name}=`,'Path=/','HttpOnly','Max-Age=0','SameSite=Lax'];
  if(secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}
/* Resolve the session for a request.
   `want` ('admin' | 'customer') selects WHICH cookie may be used. Admin and
   customer sessions are completely separate: previously both fell back to
   `hss_admin_token || hss_token`, so a customer logout in another tab revoked
   the ADMIN token and the dashboard died with reason="revoked". */
function getSession(req, want){
  const h = req.headers.authorization || '';
  let bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  // Some hosting proxies strip Authorization headers and cookies from
  // cross-origin/iframe traffic. Accept the token from a query parameter or a
  // request-body field as well, so the session survives those environments.
  if(!bearer && req.body && req.body.__t)  bearer = String(req.body.__t);
  const c = parseCookies(req);
  const cookieTok = (want === 'admin')    ? (c.hss_admin_token || null)
                  : (want === 'customer') ? (c.hss_token || null)
                  : (c.hss_admin_token || c.hss_token || null);

  // Try every credential the caller presented; the FIRST valid one wins.
  // A stale/garbage Bearer token must not shadow a valid session cookie.
  const candidates = [bearer, cookieTok].filter(Boolean);
  for(const cand of candidates){
    if(db.revoked && db.revoked[cand]) continue;
    const cl = verifyToken(cand);
    if(cl && tokenCurrent(cl)) return { token: cand, type: cl.t, id: cl.id, createdAt: cl.iat };
    if(db.sessions[cand]) return { token: cand, ...db.sessions[cand] };
  }
  const tok = candidates[0] || null;
  if(!tok){ req._authFail='no-token'; return null; }
  // Revoked (logged out) tokens are recorded so they stop working everywhere.
  if(db.revoked && db.revoked[tok]){ req._authFail='revoked'; return null; }
  // 1) Stateless, signed token — verifiable by ANY instance, no shared state.
  const claims = verifyToken(tok);
  if(claims && tokenCurrent(claims)) return { token: tok, type: claims.t, id: claims.id, createdAt: claims.iat };
  // 2) Fall back to a legacy in-memory session (tokens issued before this change).
  if(db.sessions[tok]) return { token: tok, ...db.sessions[tok] };
  req._authFail = tok.indexOf('.')<0 ? 'legacy-token-not-in-memory' : 'bad-signature-or-expired';
  return null;
}
async function requireAdmin(req,res,next){
  const s = getSession(req,'admin');
  // Sliding renewal: while the admin is active, keep the session alive by
  // re-issuing the cookie well before expiry. Removes any dependency on a
  // separate refresh grant that could go missing.
  if(s && s.type==='admin'){
    try{
      const age = Date.now() - (s.createdAt || 0);
      if(age > SESSION_TTL_MS/2){
        const fresh = issueSession('admin','admin');
        await saveDB();
        setSessionCookie(req,res,'hss_admin_token',fresh);
        res.setHeader('X-HSS-New-Token', fresh);
      }
    }catch(e){}
  }
  if(!s || s.type!=='admin'){
    const why = req._authFail || (s?'wrong-session-type':'unknown');
    console.warn('[auth] 401 %s %s reason=%s hdr=%s cookie=%s',
      req.method, req.path, why,
      req.headers.authorization?'yes':'no',
      req.headers.cookie && /hss_admin_token/.test(req.headers.cookie)?'yes':'no');
    return res.status(401).json({ error:'Admin login required', reason: why });
  }
  req.admin = s; next();
}
function optionalCustomer(req,res,next){
  req.customerSession = getSession(req,'customer');
  next();
}
function requireCustomer(req,res,next){
  const s = getSession(req,'customer');
  if(!s || s.type!=='customer') return res.status(401).json({ error:'Login required' });
  req.cust = db.customers.find(c=>c.id===s.id);
  if(!req.cust) return res.status(401).json({ error:'Account not found' });
  next();
}
const validMobile = m => /^01[3-9]\d{8}$/.test(String(m||'').trim());
function publicSettings(){
  const s = db.settings;
  return { brand:s.brand, contact:{ mobile:s.contact.mobile, whatsapp:s.contact.whatsapp, email:s.contact.email,
      instagram:s.contact.instagram, facebook:s.contact.facebook, address:s.contact.address },
    delivery:s.delivery, payments:{ cod:{enabled:s.payments.cod.enabled},
      bkash:{enabled:s.payments.bkash.enabled, number:s.payments.bkash.number, accountType:s.payments.bkash.accountType, instruction:s.payments.bkash.instruction},
      nagad:{enabled:s.payments.nagad.enabled, number:s.payments.nagad.number, accountType:s.payments.nagad.accountType, instruction:s.payments.nagad.instruction} },
    seo:s.seo, announcement:s.announcement };
}

/* ---------------- public: settings / categories / homepage ---------------- */
app.get('/api/health', (req,res)=>res.json({
  ok:true, time:Date.now(),
  sessionSecretConfigured: !!SESSION_SECRET && SESSION_SECRET.length>=32,  // never the value
  statelessTokens: true,
  adminConfigured: !!(db.settings && db.settings.admin && db.settings.admin.username),
  secureCookies: isSecureReq(req)
}));
app.get('/api/settings', (req,res)=>res.json(publicSettings()));
app.get('/api/categories', (req,res)=>{
  res.json(db.categories.filter(c=>c.visible!==false).sort((a,b)=>(a.sort||0)-(b.sort||0)));
});
app.get('/api/homepage', (req,res)=>{
  const h = db.homepage || {};
  const byId = Object.fromEntries(db.products.filter(p=>p.published).map(p=>[p.id,p]));
  const resolve = ids => (ids||[]).map(id=>byId[id]).filter(Boolean).map(pubProduct);
  const cats = Object.fromEntries(db.categories.map(c=>[c.id,c]));
  res.json({
    hero: h.hero || {}, perksTitle: h.perksTitle || '',
    showSections: h.showSections || {},
    featured: resolve(h.featuredIds), newArrivals: resolve(h.newIds), bestsellers: resolve(h.bestsellerIds),
    collections: (h.collectionCategoryIds||[]).map(id=>cats[id]).filter(c=>c&&c.visible!==false)
  });
});

/* ---------------- public: Bangladesh geo (all divisions/districts/thanas) ---------------- */
app.get('/api/geo', (req,res)=>{
  if(req.headers['if-none-match']===GEO_ETAG) return res.status(304).end();
  res.set({ 'Content-Type':'application/json; charset=utf-8', 'ETag':GEO_ETAG,
    'Cache-Control':'public, max-age=604800, immutable' });
  const ae = String(req.headers['accept-encoding']||'');
  if(/\bgzip\b/.test(ae)){ res.set('Content-Encoding','gzip'); return res.end(GEO_GZ); }
  res.end(GEO_JSON);
});
// Dhaka-district thanas that count as "Inside Dhaka" city rate
const DHAKA_CITY = new Set(['adabor','airport','badda','banani','bangshal','bhashantek','bhatara','cantonment','chackbazar','dakshinkhan','darus salam','demra','dhanmondi','gendaria','gulshan','hazaribagh','jatrabari','kadamtali','kafrul','kalabagan','kamrangirchar','khilgaon','khilkhet','kotwali','lalbagh','mirpur','mohammadpur','motijheel','mugda','new market','pallabi','paltan','ramna','rampura','rupnagar','sabujbagh','shah ali','shahbagh','shahjahanpur','sher-e-bangla nagar','shyampur','sutrapur','tejgaon','tejgaon industrial area','turag','uttara east','uttara west','uttarkhan','vatara','wari']);
function resolveZone(district, area){
  const d=String(district||'').toLowerCase().trim();
  const a=String(area||'').toLowerCase().trim();
  if(d==='dhaka' && DHAKA_CITY.has(a)) return 'inside';
  return 'outside';
}
app.get('/api/delivery/quote', (req,res)=>{
  const zone = resolveZone(req.query.district, req.query.area);
  const del = db.settings.delivery;
  const sub = Number(req.query.subtotal)||0;
  let charge = zone==='inside' ? del.inside : del.outside;
  const free = del.freeAbove>0 && sub>=del.freeAbove;
  if(free) charge=0;
  res.json({ zone, charge, free, label: zone==='inside'?del.insideLabel:del.outsideLabel });
});

/* ---------------- public: reviews ---------------- */
app.get('/api/products/:slug/reviews', (req,res)=>{
  const p=db.products.find(x=>x.slug===req.params.slug);
  if(!p) return res.status(404).json({ error:'Product not found' });
  const list=(db.reviews||[]).filter(r=>r.productId===p.id && r.approved)
    .sort((a,b)=>b.createdAt-a.createdAt)
    .map(r=>({ id:r.id, name:r.name, rating:r.rating, text:r.text, createdAt:r.createdAt }));
  const avg = list.length ? Math.round((list.reduce((s,r)=>s+r.rating,0)/list.length)*10)/10 : 0;
  res.json({ reviews:list, count:list.length, average:avg });
});
app.post('/api/products/:slug/reviews', rateLimit('reviews', 10, 60*60*1000), async (req,res)=>{
  const p=db.products.find(x=>x.slug===req.params.slug);
  if(!p) return res.status(404).json({ error:'Product not found' });
  const name=String(req.body.name||'').trim(), text=String(req.body.text||'').trim();
  const rating=Math.max(1,Math.min(5,parseInt(req.body.rating)||0));
  if(name.length<2) return res.status(400).json({ error:'Please enter your name' });
  if(!rating) return res.status(400).json({ error:'Please choose a star rating' });
  if(text.length<4) return res.status(400).json({ error:'Please write a short review' });
  db.reviews=db.reviews||[];
  const r={ id:uid('r'), productId:p.id, name:name.slice(0,60), rating, text:text.slice(0,600),
    approved:false, createdAt:Date.now() };
  db.reviews.unshift(r); await saveDB();
  res.json({ ok:true, pending:true });
});

/* ---------------- public: abandoned cart capture ---------------- */
app.post('/api/cart/track', rateLimit('cart-track', 200, 15*60*1000), async (req,res)=>{
  try{
    const b=req.body||{};
    const items=Array.isArray(b.items)?b.items.slice(0,20):[];
    if(!items.length) return res.json({ ok:true });
    const key=String(b.key||'').slice(0,60) || uid('ac');
    db.carts=db.carts||[];
    let c=db.carts.find(x=>x.key===key);
    const named=items.map(it=>{ const p=db.products.find(x=>x.id===it.id); return p?{ name:p.name, qty:Math.max(1, Math.min(20, parseInt(it.qty)||1)), price:effPrice(p) }:null; }).filter(Boolean);
    const value=named.reduce((s,i)=>s+i.price*i.qty,0);
    if(!c){ c={ key, items:named, value, name:'', mobile:'', recovered:false, createdAt:Date.now(), updatedAt:Date.now() }; db.carts.unshift(c); }
    else { c.items=named; c.value=value; c.updatedAt=Date.now(); }
    if(b.name) c.name=String(b.name).slice(0,60);
    if(b.mobile) c.mobile=String(b.mobile).slice(0,20);
    if(db.carts.length>500) db.carts.length=500;
    await saveDB(); res.json({ ok:true, key });
  }catch(e){ res.json({ ok:true }); }
});

/* ---------------- custom design requests ---------------- */
const DESIGN_STATUSES = ['submitted','reviewing','quoted','approved','in-production','completed','rejected'];
// File extension is derived from the validated MIME type, never from the
// client-supplied name: "evil.html" sent as image/png must not be stored (and
// then served from this origin) as an .html file.
const MIME_EXT = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'image/gif':'.gif', 'application/pdf':'.pdf' };
const designUpload = multer({
  storage: multer.diskStorage({
    destination:(r,f,cb)=>{ try{ fs.mkdirSync(UPLOAD_DIR,{recursive:true}); }catch(e){} cb(null,UPLOAD_DIR); },
    filename:(r,f,cb)=>{ const ext=MIME_EXT[f.mimetype]||'.bin';
      cb(null,'design-'+Date.now().toString(36)+'-'+crypto.randomBytes(5).toString('hex')+ext); }
  }),
  limits:{ fileSize:8*1024*1024, files:5 },
  fileFilter:(r,f,cb)=>MIME_EXT[f.mimetype]?cb(null,true):cb(new Error('Upload images or PDF only'))
});
app.post('/api/designs', rateLimit('designs', 10, 60*60*1000), requireCustomer, async (req,res)=>{
  designUpload.array('files',5)(req,res,async err=>{
    if(err) return res.status(400).json({ error:err.message||'Upload failed' });
    const b=req.body||{};
    const productType=String(b.productType||'').trim();
    const details=String(b.details||'').trim();
    if(!productType) return res.status(400).json({ error:'Please choose what you want designed' });
    if(details.length<10) return res.status(400).json({ error:'Please describe your design idea (at least 10 characters)' });
    const files=(req.files||[]).map(f=>'/uploads/'+f.filename);
    db.designs=db.designs||[];
    const d={ id:'D-'+(db.meta.designSeq=(db.meta.designSeq||1001), db.meta.designSeq++),
      customerId:req.cust.id, name:req.cust.name, mobile:req.cust.mobile,
      contact:String(b.contact||req.cust.mobile).trim().slice(0,120),
      productType:productType.slice(0,60), quantity:Math.max(1,parseInt(b.quantity)||1),
      details:details.slice(0,2000), files, status:'submitted', quote:null,
      adminNote:'', createdAt:Date.now(), updatedAt:Date.now(),
      history:[{ at:Date.now(), by:'customer', text:'Request submitted' }] };
    db.designs.unshift(d); await saveDB();
    res.json({ ok:true, design:d });
  });
});
app.get('/api/designs/mine', requireCustomer, (req,res)=>{
  const list=(db.designs||[]).filter(d=>d.customerId===req.cust.id);
  res.json({ designs:list, statuses:DESIGN_STATUSES });
});
app.get('/api/admin/designs', requireAdmin, (req,res)=>{
  const { status }=req.query;
  let list=(db.designs||[]).slice();
  if(status) list=list.filter(d=>d.status===status);
  res.json({ designs:list, statuses:DESIGN_STATUSES,
    pending:(db.designs||[]).filter(d=>d.status==='submitted').length });
});
app.put('/api/admin/designs/:id', requireAdmin, async (req,res)=>{
  const d=(db.designs||[]).find(x=>x.id===req.params.id);
  if(!d) return res.status(404).json({ error:'Request not found' });
  const ch=[];
  if(req.body.status && DESIGN_STATUSES.includes(req.body.status) && req.body.status!==d.status){
    ch.push(`Status: ${d.status} → ${req.body.status}`); d.status=req.body.status;
  }
  if(req.body.quote!==undefined){ const q=req.body.quote===''||req.body.quote===null?null:Math.max(0,Number(req.body.quote)||0);
    if(q!==d.quote){ ch.push('Quote: '+(q===null?'cleared':'৳'+q)); d.quote=q; } }
  if(req.body.adminNote!==undefined) d.adminNote=String(req.body.adminNote).slice(0,1000);
  if(ch.length){ d.history.push({ at:Date.now(), by:'admin', text:ch.join(' | ') }); d.updatedAt=Date.now(); }
  await saveDB(); res.json({ ok:true, design:d });
});
app.delete('/api/admin/designs/:id', requireAdmin, async (req,res)=>{
  const i=(db.designs||[]).findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({ error:'Request not found' });
  db.designs.splice(i,1); await saveDB(); res.json({ ok:true });
});

/* ---------------- public: products ---------------- */
app.get('/api/products', (req,res)=>{
  try{
    let list = db.products.filter(p=>p.published);
    const { q, category, min, max, sort='newest', page='1', limit='24', featured, isNew, bestseller, inStock } = req.query;
    if(category){
      const catIds = String(category).split(',').filter(Boolean);
      list = list.filter(p=>p.categoryIds.some(c=>catIds.includes(c)));
    }
    if(q){
      const needle = String(q).toLowerCase().trim();
      const catName = Object.fromEntries(db.categories.map(c=>[c.id,(c.name+' '+c.slug).toLowerCase()]));
      list = list.filter(p=>{
        const hay = [p.name, p.slug, p.type||'poster', (p.sizes||[]).map(x=>x.size).join(' '), (p.bundleItems||[]).join(' '), 'set '+p.setNo, 'set-'+p.setNo, '#'+p.setNo, p.setNo, p.sku,
          (p.tags||[]).join(' '), p.short||'', ...(p.categoryIds||[]).map(id=>catName[id]||'')].join(' ').toLowerCase();
        return needle.split(/\s+/).every(w=>hay.includes(w));
      });
    }
    if(min) list = list.filter(p=>effPrice(p) >= Number(min));
    if(max) list = list.filter(p=>effPrice(p) <= Number(max));
    if(featured==='1') list = list.filter(p=>p.featured);
    if(isNew==='1') list = list.filter(p=>p.isNew);
    if(bestseller==='1') list = list.filter(p=>p.bestseller);
    if(inStock==='1') list = list.filter(p=>p.stock>0||p.allowBackorder);
    if(req.query.type) { const types=String(req.query.type).split(','); list=list.filter(p=>types.includes(p.type||'poster')); }
    const sorts = {
      'newest': (a,b)=>b.createdAt-a.createdAt,
      'price-asc': (a,b)=>effPrice(a)-effPrice(b),
      'price-desc': (a,b)=>effPrice(b)-effPrice(a),
      'popular': (a,b)=>(b.sold||0)-(a.sold||0),
      'name': (a,b)=>a.name.localeCompare(b.name),
      'featured': (a,b)=>((b.featured?1:0)-(a.featured?1:0)) || ((a.sort||0)-(b.sort||0)),
      'manual': (a,b)=>(a.sort||0)-(b.sort||0),
    };
    list = list.slice().sort(sorts[sort]||sorts.newest);
    const pg = Math.max(1, parseInt(page)||1), lim = Math.min(60, Math.max(1, parseInt(limit)||24));
    const total = list.length;
    const items = list.slice((pg-1)*lim, pg*lim).map(pubProduct);
    const prices = db.products.filter(p=>p.published).map(effPrice);
    res.json({ items, total, page:pg, pages: Math.max(1, Math.ceil(total/lim)),
      priceRange: prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:{min:0,max:0} });
  }catch(e){ res.status(500).json({ error:'Failed to load products' }); }
});
app.get('/api/products/:key', (req,res)=>{
  const p = db.products.find(x=>x.slug===req.params.key||x.id===req.params.key);
  if(!p || !p.published) return res.status(404).json({ error:'Product not found' });
  const related = db.products.filter(x=>x.published && x.id!==p.id && x.categoryIds.some(c=>p.categoryIds.includes(c))).slice(0,8).map(pubProduct);
  res.json({ product: pubProduct(p), related });
});
app.post('/api/products/:key/view', async (req,res)=>{
  const p = db.products.find(x=>x.slug===req.params.key||x.id===req.params.key);
  if(p){ p.views=(p.views||0)+1; await saveDB(); }
  res.json({ok:true});
});

/* ---------------- coupons ---------------- */
function couponFor(code, subtotal){
  const c = db.coupons.find(x=>x.code===String(code||'').toUpperCase().trim());
  if(!c || !c.active) return { error:'Invalid coupon code' };
  if(subtotal < (c.minOrder||0)) return { error:`Minimum order ৳${c.minOrder} for this coupon` };
  const discount = c.type==='percent' ? Math.round(subtotal*c.value/100) : Math.min(c.value, subtotal);
  return { coupon:c, discount };
}
app.post('/api/coupons/validate', (req,res)=>{
  const { code, subtotal } = req.body||{};
  const r = couponFor(code, Number(subtotal)||0);
  if(r.error) return res.status(400).json({ error:r.error });
  res.json({ code:r.coupon.code, discount:r.discount });
});

/* ---------------- orders (public) ---------------- */
const ORDER_STATUSES = ['pending','payment-pending','payment-verified','confirmed','processing','ready','shipped','delivered','cancelled'];
app.post('/api/orders', rateLimit('orders', 20, 60*60*1000), optionalCustomer, async (req,res)=>{
  try{
    const b = req.body||{};
    const name = String(b.name||'').trim();
    const mobile = String(b.mobile||'').trim();
    const address = String(b.address||'').trim();
    const division = String(b.division||'').trim();
    const district = String(b.district||'').trim();
    const area = String(b.area||b.thana||'').trim();
    const locality = String(b.locality||b.city||'').trim();
    const landmark = String(b.landmark||'').trim();
    if(name.length<3) return res.status(400).json({ error:'Please enter your full name' });
    if(!validMobile(mobile)) return res.status(400).json({ error:'Please enter a valid 11-digit mobile number' });
    if(!division) return res.status(400).json({ error:'Please select your division' });
    const dInfo = DISTRICTS[district.toLowerCase()];
    if(!dInfo) return res.status(400).json({ error:'Please select a valid district' });
    if(!area || !dInfo.areas.has(area.toLowerCase()))
      return res.status(400).json({ error:'Please select your thana / upazila' });
    if(address.length<8) return res.status(400).json({ error:'Please enter your full delivery address (house, road, landmark)' });
    const zone = resolveZone(district, area);
    const payMethod = ['cod','bkash','nagad'].includes(b.paymentMethod) ? b.paymentMethod : 'cod';
    const payCfg = db.settings.payments;
    if(payMethod==='bkash' && !payCfg.bkash.enabled) return res.status(400).json({ error:'bKash is currently unavailable' });
    if(payMethod==='nagad' && !payCfg.nagad.enabled) return res.status(400).json({ error:'Nagad is currently unavailable' });
    if(payMethod==='cod' && !payCfg.cod.enabled) return res.status(400).json({ error:'Cash on Delivery is currently unavailable' });
    const trxId = String(b.trxId||'').trim();
    if((payMethod==='bkash'||payMethod==='nagad') && !trxId)
      return res.status(400).json({ error:'Please enter your bKash/Nagad Transaction ID (TrxID)' });
    const merged = new Map();
    for(const it of (Array.isArray(b.items) ? b.items : []).slice(0, 50)){
      if(!it || typeof it !== 'object') continue;
      const size = String(it.size || '').trim();
      const k = String(it.id) + '|' + size.toLowerCase();
      const q = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
      const m = merged.get(k);
      if(m) m.qty += q; else merged.set(k, { id: it.id, size, qty: q });
    }
    const itemsIn = [...merged.values()];
    if(itemsIn.some(it => it.qty > 20)) return res.status(400).json({ error:'You can order at most 20 of the same set per order' });
    if(!itemsIn.length) return res.status(400).json({ error:'Your cart is empty' });
    const items=[]; let subtotal=0;
    for(const it of itemsIn){
      const p = db.products.find(x=>x.id===it.id && x.published);
      if(!p) return res.status(400).json({ error:'A product in your cart is no longer available' });
      const qty = it.qty;                      // merged + validated above (1–20)
      const size = it.size;
      const sizes = p.sizes||[];
      if(sizes.length){
        if(!size) return res.status(400).json({ error:`Please choose a size for "${p.name}"` });
        const row = sizes.find(x=>x.size.toLowerCase()===size.toLowerCase());
        if(!row) return res.status(400).json({ error:`Size "${size}" is not available for "${p.name}"` });
        if(!p.allowBackorder && row.stock < qty)
          return res.status(400).json({ error:`"${p.name}" size ${row.size} only has ${row.stock} left in stock` });
      } else if(!p.allowBackorder && p.stock < qty){
        return res.status(400).json({ error:`"${p.name}" only has ${p.stock} left in stock` });
      }
      const price = effPrice(p);
      items.push({ productId:p.id, slug:p.slug, name:p.name, cover:p.cover, price, qty,
        size: size||null, type:p.type||'poster' });
      subtotal += price*qty;
    }
    let discount=0, couponCode=null;
    if(b.coupon){
      const r = couponFor(b.coupon, subtotal);
      if(r.error) return res.status(400).json({ error:r.error });
      discount=r.discount; couponCode=r.coupon.code; r.coupon.usage=(r.coupon.usage||0)+1;
    }
    const del = db.settings.delivery;
    let charge = zone==='inside' ? del.inside : del.outside;
    if(del.freeAbove>0 && (subtotal-discount) >= del.freeAbove) charge = 0;
    const total = subtotal - discount + charge;
    const id = 'HSS-' + (db.meta.orderSeq++);
    const sess = req.customerSession;
    const order = {
      id, items, subtotal, discount, coupon:couponCode,
      zone, deliveryCharge:charge, total,
      customer:{ name: name.slice(0,80), mobile, address: address.slice(0,500), area, district, division,
        locality: locality.slice(0,120), landmark: landmark.slice(0,160),
        customerId: (sess&&sess.type==='customer')?sess.id:null },
      paymentMethod:payMethod, trxId: trxId||null,
      paymentStatus: payMethod==='cod' ? 'unpaid' : 'pending-verification',
      status: payMethod==='cod' ? 'pending' : 'payment-pending',
      notes: String(b.notes||'').trim().slice(0,500),
      createdAt: Date.now(), updatedAt: Date.now(),
      history:[{ at:Date.now(), by:'system', text:'Order placed' }]
    };
    for(const it of items){
      const p = db.products.find(x=>x.id===it.productId);
      if(it.size && (p.sizes||[]).length){
        const row=p.sizes.find(x=>x.size.toLowerCase()===it.size.toLowerCase());
        if(row) row.stock=Math.max(0,row.stock-it.qty);
        p.stock=p.sizes.reduce((t,x)=>t+x.stock,0);
      } else {
        p.stock = Math.max(0, p.stock - it.qty);
      }
      p.sold = (p.sold||0) + it.qty;
    }
    if(b.cartKey && db.carts){ const c=db.carts.find(x=>x.key===b.cartKey); if(c) c.recovered=true; }
    db.orders.unshift(order); await saveDB();
    res.json({ ok:true, order: sanitizeOrder(order) });
  }catch(e){ console.error(e); res.status(500).json({ error:'Could not place order. Please try again.' }); }
});
function sanitizeOrder(o){
  return { id:o.id, items:o.items, subtotal:o.subtotal, discount:o.discount, coupon:o.coupon,
    zone:o.zone, deliveryCharge:o.deliveryCharge, total:o.total,
    customer:{ name:o.customer.name, mobile:o.customer.mobile, address:o.customer.address, area:o.customer.area,
    district:o.customer.district||'', division:o.customer.division||'',
    locality:o.customer.locality||'', landmark:o.customer.landmark||'',
    customerId:o.customer.customerId||null,
    accountType:o.customer.customerId ? 'registered' : 'guest',
    fullAddress:[o.customer.address,o.customer.locality,o.customer.area,o.customer.district,o.customer.division].filter(Boolean).join(', ')
      +(o.customer.landmark?' (Landmark: '+o.customer.landmark+')':'') },
    paymentMethod:o.paymentMethod, trxId:o.trxId, paymentStatus:o.paymentStatus, status:o.status,
    notes:o.notes, createdAt:o.createdAt, updatedAt:o.updatedAt, history:o.history||[] };
}
app.get('/api/orders/track', rateLimit('track', 30, 15*60*1000), (req,res)=>{
  const id = String(req.query.id||'').trim().toUpperCase();
  const mobile = String(req.query.mobile||'').trim();
  if(!id || !mobile) return res.status(400).json({ error:'Order ID and mobile number are required' });
  const o = db.orders.find(x=>x.id.toUpperCase()===id);
  if(!o || o.customer.mobile!==mobile) return res.status(404).json({ error:'Order not found. Check your Order ID and mobile number.' });
  res.json({ order: sanitizeOrder(o) });
});
app.get('/api/orders/mine', requireCustomer, (req,res)=>{
  const mine = db.orders.filter(o=>o.customer.customerId===req.cust.id || o.customer.mobile===req.cust.mobile);
  res.json({ orders: mine.map(sanitizeOrder) });
});

/* ---------------- customer auth ---------------- */
/* One canonical customer/profile shape. Mirrors exactly the fields the
   checkout form collects, so a logged-in customer never retypes them. */
function pubCustomer(c){
  return { id:c.id, name:c.name, mobile:c.mobile,
    address:c.address||'', area:c.area||'',
    division:c.division||'', district:c.district||'',
    locality:c.locality||'', landmark:c.landmark||'' };
}

app.post('/api/auth/register', rateLimit('register', 10, 60*60*1000), async (req,res)=>{
  const name=String(req.body.name||'').trim(), mobile=String(req.body.mobile||'').trim();
  const pw=String(req.body.password||''), address=String(req.body.address||'').trim(), area=String(req.body.area||'').trim();
  if(name.length<3) return res.status(400).json({ error:'Please enter your full name' });
  if(!validMobile(mobile)) return res.status(400).json({ error:'Please enter a valid 11-digit mobile number' });
  if(pw.length<4) return res.status(400).json({ error:'Password must be at least 4 characters' });
  if(db.customers.some(c=>c.mobile===mobile)) return res.status(400).json({ error:'This mobile number is already registered. Please login.' });
  const salt=crypto.randomBytes(16).toString('hex');
  const c={ id:'c'+(db.meta.customerSeq++), name, mobile, salt, passHash:hash(pw,salt),
    address, area, division:'', district:'', locality:'', landmark:'', createdAt:Date.now() };
  db.customers.push(c);
  const token=issueSession('customer',c.id);
  await saveDB();
  setSessionCookie(req,res,'hss_token',token);
  res.json({ ok:true, token, customer:pubCustomer(c) });
});
app.post('/api/auth/login', rateLimit('login', 15, 15*60*1000), async (req,res)=>{
  const mobile=String(req.body.mobile||'').trim(), pw=String(req.body.password||'');
  const c=db.customers.find(x=>x.mobile===mobile);
  if(!c || hash(pw,c.salt)!==c.passHash) return res.status(400).json({ error:'Wrong mobile number or password' });
  const token=issueSession('customer',c.id);
  await saveDB();
  setSessionCookie(req,res,'hss_token',token);
  res.json({ ok:true, token, customer:pubCustomer(c) });
});
app.get('/api/auth/me', requireCustomer, (req,res)=>{
  res.json({ customer: pubCustomer(req.cust) });
});
app.put('/api/auth/me', requireCustomer, async (req,res)=>{
  // The customer is taken from the authenticated session only; any id sent by
  // the client is ignored, so one customer can never edit another's profile.
  const c = req.cust, b = req.body || {};
  if(b.name !== undefined){
    const n = String(b.name).trim();
    if(n.length < 3) return res.status(400).json({ error:'Please enter your full name' });
    c.name = n.slice(0,80);
  }
  if(b.mobile !== undefined){
    const m = String(b.mobile).trim();
    if(!validMobile(m)) return res.status(400).json({ error:'Please enter a valid 11-digit mobile number' });
    if(db.customers.some(x => x.mobile === m && x.id !== c.id))
      return res.status(400).json({ error:'This mobile number is already registered to another account' });
    c.mobile = m;
  }
  // Delivery location: validate against the same Bangladesh geo tree checkout uses.
  const div  = b.division !== undefined ? String(b.division).trim()  : c.division;
  const dist = b.district !== undefined ? String(b.district).trim()  : c.district;
  const area = b.area     !== undefined ? String(b.area).trim()      : c.area;
  if(dist){
    const info = DISTRICTS[String(dist).toLowerCase()];
    if(!info) return res.status(400).json({ error:'Please select a valid district' });
    if(area && !info.areas.has(String(area).toLowerCase()))
      return res.status(400).json({ error:'Please select a valid thana / upazila for this district' });
  }
  if(b.division !== undefined) c.division = div.slice(0,60);
  if(b.district !== undefined) c.district = dist.slice(0,60);
  if(b.area     !== undefined) c.area     = area.slice(0,80);
  if(b.locality !== undefined) c.locality = String(b.locality).slice(0,120);
  if(b.landmark !== undefined) c.landmark = String(b.landmark).slice(0,160);
  if(b.address  !== undefined) c.address  = String(b.address).slice(0,500);
  await saveDB();
  res.json({ ok:true, customer: pubCustomer(c) });
});
/* ---------- customer password reset ----------
   SECURITY: the old flow handed a valid reset token to ANYONE who typed a
   registered mobile number (no SMS / no verification) — i.e. any account could
   be taken over. HSS has no SMS gateway, so verification now happens through
   the shop: the customer messages HSS on WhatsApp from their registered number,
   the admin generates a one-time reset code (Admin → Customers → Reset code)
   and sends it back. The customer enters mobile + code + new password.
   Codes are stateless (HMAC of the customer's CURRENT password hash and a
   30-minute time slot), valid 30–60 minutes, and become invalid the moment the
   password changes (single use). No extra database fields are needed. */
const RESET_SLOT_MS = 30 * 60 * 1000;
const RESET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 chars, no 0/O/1/I
function resetCodeFor(c, slot){
  const h = crypto.createHmac('sha256', SESSION_SECRET).update('pwreset|' + c.id + '|' + c.passHash + '|' + slot).digest();
  let code = '';
  for(let i = 0; i < 8; i++) code += RESET_ALPHABET[h[i] & 31];
  return code;
}
function normResetCode(code){ return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function resetCodeValid(c, code){
  const want = normResetCode(code);
  if(want.length !== 8) return false;
  const slot = Math.floor(Date.now() / RESET_SLOT_MS);
  return [slot, slot - 1].some(sl => crypto.timingSafeEqual(Buffer.from(resetCodeFor(c, sl)), Buffer.from(want)));
}

app.post('/api/auth/forgot', rateLimit('forgot', 10, 15*60*1000), (req,res)=>{
  const mobile = String(req.body.mobile || '').trim();
  if(mobile && !validMobile(mobile)) return res.status(400).json({ error:'Please enter a valid 11-digit mobile number' });
  // Same answer whether or not the number is registered (no account probing),
  // and never a token.
  const wa = (db.settings.contact && (db.settings.contact.whatsapp || db.settings.contact.mobile)) || '';
  res.json({ ok:true, whatsapp: wa,
    message:'To reset your password, message us on WhatsApp from your registered mobile number. ' +
            'We will send you a one-time reset code (valid for 30 minutes).' });
});

app.post('/api/auth/reset',
  rateLimit('reset-ip', 10, 15*60*1000),
  rateLimit('reset-mobile', 8, 15*60*1000, req => String(req.body.mobile || '').trim()),
  async (req,res)=>{
  const mobile = String(req.body.mobile || '').trim();
  const code = req.body.code;
  const pw  = String(req.body.password || '');
  if(!validMobile(mobile)) return res.status(400).json({ error:'Please enter your registered 11-digit mobile number' });
  if(!normResetCode(code)) return res.status(400).json({ error:'Please enter the reset code we sent you' });
  if(pw.length < 4) return res.status(400).json({ error:'Password must be at least 4 characters' });
  const c = db.customers.find(x => x.mobile === mobile);
  if(!c || !resetCodeValid(c, code)) {
    return res.status(400).json({ error:'This reset code is invalid or has expired. Please ask us for a new one.' });
  }
  c.salt = crypto.randomBytes(16).toString('hex');
  c.passHash = hash(pw, c.salt);      // also invalidates the code and all older tokens (pv)
  Object.keys(db.sessions).forEach(t=>{
    if(db.sessions[t].type === 'customer' && db.sessions[t].id === c.id){
      db.revoked = db.revoked || {}; db.revoked[t] = Date.now(); delete db.sessions[t];
    }
  });
  const token = issueSession('customer', c.id);
  await saveDB();
  setSessionCookie(req,res,'hss_token',token);
  res.json({ ok:true, token, customer: pubCustomer(c) });
});

/* Admin: generate a one-time reset code for a customer (send it on WhatsApp). */
app.post('/api/admin/customers/:id/reset-code', requireAdmin, (req,res)=>{
  const c = db.customers.find(x => x.id === req.params.id);
  if(!c) return res.status(404).json({ error:'Customer not found' });
  const raw = resetCodeFor(c, Math.floor(Date.now() / RESET_SLOT_MS));
  const code = raw.slice(0, 4) + '-' + raw.slice(4);
  const msg = 'Highstreet Society: your password reset code is ' + code +
    '. Enter it at /account → Forgot password within 30 minutes. If you did not ask for this, ignore this message.';
  const num = String(c.mobile).replace(/\D/g, '').replace(/^0/, '880');
  res.json({ ok:true, code, mobile:c.mobile, validMinutes:30,
    whatsappUrl:'https://wa.me/' + num + '?text=' + encodeURIComponent(msg) });
});

app.post('/api/auth/logout', async (req,res)=>{
  const s=getSession(req,'customer');
  if(s && s.type==='customer'){            // never revoke an admin token here
    delete db.sessions[s.token];
    db.revoked = db.revoked || {}; db.revoked[s.token] = Date.now(); await saveDB();
  }
  clearSessionCookie(req,res,'hss_token');
  res.json({ ok:true });
});

/* ---------------- admin auth ---------------- */
app.post('/api/admin/login', rateLimit('admin-login', 10, 15*60*1000), async (req,res)=>{
  const { username, password } = req.body||{};
  const a=db.settings.admin;
  if(username!==a.username || hash(String(password||''),a.salt)!==a.passHash)
    return res.status(401).json({ error:'Wrong username or password' });
  const token=issueSession('admin','admin');
  const refresh=issueAdminRefresh();
  await saveDB();
  setSessionCookie(req,res,'hss_admin_token',token);
  setSessionCookie(req,res,'hss_admin_refresh',refresh);
  res.json({ ok:true, token, refresh, username:a.username });
});
app.post('/api/admin/refresh', async (req,res)=>{
  const c = parseCookies(req);
  const fromBody = req.body && req.body.refresh;
  const hdr = req.headers['x-hss-refresh'];          // still accepted (back-compat)
  const tok = fromBody || hdr || c.hss_admin_refresh || null;
  let claims = tok ? verifyToken(tok) : null;
  if(!claims || claims.t !== 'admin-refresh' || !tokenCurrent(claims)){
    // Fall back to the current access token / cookie: if the caller can prove
    // they already hold a valid admin session, renewal is legitimate.
    const cur = getSession(req,'admin');
    if(cur && cur.type === 'admin'){
      const token = issueSession('admin','admin');
      const fresh = issueAdminRefresh();
      await saveDB();
      setSessionCookie(req,res,'hss_admin_token',token);
      setSessionCookie(req,res,'hss_admin_refresh',fresh);
      return res.json({ ok:true, token, refresh: fresh });
    }
    return res.status(401).json({ error:'Admin login required', reason:'no-refresh-grant' });
  }
  if(db.revoked && db.revoked[tok])
    return res.status(401).json({ error:'Admin login required', reason:'refresh-revoked' });
  const token = issueSession('admin','admin');
  const fresh = issueAdminRefresh();
  await saveDB();
  setSessionCookie(req,res,'hss_admin_token',token);
  setSessionCookie(req,res,'hss_admin_refresh',fresh);
  res.json({ ok:true, token, refresh: fresh });
});
app.get('/api/admin/me', requireAdmin, (req,res)=>res.json({ ok:true, username:db.settings.admin.username }));
app.post('/api/admin/logout', requireAdmin, async (req,res)=>{
  delete db.sessions[req.admin.token];
  db.revoked = db.revoked || {}; db.revoked[req.admin.token] = Date.now();
  const c = parseCookies(req);
  const rt = (req.body && req.body.refresh) || req.headers['x-hss-refresh'] || c.hss_admin_refresh;
  if(rt) db.revoked[rt] = Date.now();
  await saveDB();
  clearSessionCookie(req,res,'hss_admin_token');
  clearSessionCookie(req,res,'hss_admin_refresh');
  res.json({ok:true});
});


/* ---------------- admin: dashboard ---------------- */
app.get('/api/admin/stats', requireAdmin, (req,res)=>{
  const valid=db.orders.filter(o=>o.status!=='cancelled');
  const revenue=valid.filter(o=>!['pending','payment-pending'].includes(o.status)).reduce((s,o)=>s+o.total,0);
  const byStatus={}; ORDER_STATUSES.forEach(s=>byStatus[s]=db.orders.filter(o=>o.status===s).length);
  const low=db.settings.lowStockAt||5;
  res.json({
    totals:{ orders:db.orders.length, revenue, products:db.products.length, published:db.products.filter(p=>p.published).length, customers:db.customers.length },
    byStatus,
    lowStock: db.products.filter(p=>p.published&&p.stock<=low).map(p=>({id:p.id,name:p.name,stock:p.stock,sku:p.sku})).sort((a,b)=>a.stock-b.stock),
    recent: db.orders.slice(0,8).map(sanitizeOrder),
    top: db.products.slice().sort((a,b)=>(b.sold||0)-(a.sold||0)).slice(0,6).map(p=>({id:p.id,name:p.name,sold:p.sold||0,views:p.views||0,cover:p.cover}))
  });
});

/* ---------------- admin: products ---------------- */
function validateProductInput(b, isNew){
  const name=String(b.name||'').trim();
  if(!name) return { error:'Product name is required' };
  const price=Number(b.price);
  if(!(price>0)) return { error:'Price must be greater than 0' };
  let salePrice = b.salePrice===''||b.salePrice==null ? null : Number(b.salePrice);
  if(salePrice!==null && !(salePrice>0 && salePrice<price)) return { error:'Sale price must be lower than regular price' };
  const type = ['poster','clothing','combo'].includes(b.type) ? b.type : 'poster';
  const posters = Array.isArray(b.posters)?b.posters.filter(u=>u&&String(u).trim()).map(u=>String(u).trim()):[];
  if(type==='poster'){
    if(posters.length!==6) return { error:'A poster set needs exactly 6 poster images' };
  } else {
    if(posters.length>10) return { error:'Maximum 10 gallery images' };
  }
  if(type==='poster' && posters.length>8) return { error:'Maximum 8 images per set' };
  // sizes: [{size:'M', stock:5}]
  let sizes=[];
  if(Array.isArray(b.sizes)){
    sizes=b.sizes.map(x=>({ size:String(x.size||'').trim().slice(0,20),
      stock:Math.max(0,parseInt(x.stock)||0) })).filter(x=>x.size);
    const seen=new Set();
    for(const x of sizes){ const k=x.size.toLowerCase(); if(seen.has(k)) return { error:'Duplicate size: '+x.size }; seen.add(k); }
  }
  if((type==='clothing') && !sizes.length) return { error:'Add at least one size for a clothing product' };
  let bundleItems=[];
  if(Array.isArray(b.bundleItems)){
    bundleItems=b.bundleItems.map(x=>String(x||'').trim().slice(0,120)).filter(Boolean).slice(0,12);
  }
  if(type==='combo' && bundleItems.length<2) return { error:'A combo needs at least 2 items listed (e.g. Shirt, Pant)' };
  if(!String(b.cover||'').trim()) return { error:'Cover image is required' };
  let stock=parseInt(b.stock);
  if(isNaN(stock)||stock<0) return { error:'Stock must be 0 or more' };
  return { clean:{ name, short:String(b.short||'').trim().slice(0,160),
    description:String(b.description||'').trim().slice(0,5000),
    price, salePrice, stock: (type==='clothing'&&sizes.length)?sizes.reduce((t,x)=>t+x.stock,0):stock, sku:String(b.sku||'').trim().slice(0,40),
    categoryIds:(Array.isArray(b.categoryIds)?b.categoryIds:[]).filter(id=>db.categories.some(c=>c.id===id)),
    tags:String(b.tags||'').split(',').map(t=>t.trim().toLowerCase()).filter(Boolean).slice(0,20),
    cover:String(b.cover).trim(), posters, type, sizes, bundleItems,
    posterSize:String(b.posterSize||'A4').slice(0,20), boardThickness:String(b.boardThickness||'3mm').slice(0,20),
    featured:!!b.featured, isNew:!!b.isNew, bestseller:!!b.bestseller,
    published:b.published!==false, allowBackorder:!!b.allowBackorder,
    sort:parseInt(b.sort)||0, seoTitle:String(b.seoTitle||'').slice(0,120), seoDesc:String(b.seoDesc||'').slice(0,300) } };
}
app.get('/api/admin/products', requireAdmin, (req,res)=>{
  const list=db.products.slice().sort((a,b)=>(a.sort||0)-(b.sort||0)||b.createdAt-a.createdAt).map(pubProduct);
  res.json({ products:list });
});
app.post('/api/admin/products', requireAdmin, async (req,res)=>{
  const v=validateProductInput(req.body,true);
  if(v.error) return res.status(400).json({ error:v.error });
  let slug=slugify(req.body.slug||req.body.name);
  if(db.products.some(p=>p.slug===slug)) slug=slug+'-'+(db.meta.productSeq);
  const n=db.meta.productSeq++;
  const p={ id:'p'+String(n).padStart(2,'0')+uid('').slice(0,4), slug,
    setNo:String(req.body.setNo||'').trim()||String(n).padStart(2,'0'),
    views:0, sold:0, createdAt:Date.now(), updatedAt:Date.now(), ...v.clean };
  db.products.unshift(p); await saveDB();
  res.json({ ok:true, product:pubProduct(p) });
});
app.put('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const p=db.products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({ error:'Product not found' });
  const v=validateProductInput(req.body,false);
  if(v.error) return res.status(400).json({ error:v.error });
  let slug=slugify(req.body.slug||p.slug);
  if(db.products.some(x=>x.slug===slug&&x.id!==p.id)) return res.status(400).json({ error:'Another product already uses this URL slug' });
  Object.assign(p, v.clean, { slug, updatedAt:Date.now() });
  if(req.body.setNo!==undefined) p.setNo=String(req.body.setNo).trim()||p.setNo;
  await saveDB(); res.json({ ok:true, product:pubProduct(p) });
});
app.post('/api/admin/products/:id/duplicate', requireAdmin, async (req,res)=>{
  const p=db.products.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({ error:'Product not found' });
  const n=db.meta.productSeq++;
  const copy={ ...JSON.parse(JSON.stringify(p)), id:'p'+String(n).padStart(2,'0')+uid('').slice(0,4),
    slug:p.slug+'-copy-'+n, name:p.name+' (Copy)', published:false, views:0, sold:0,
    setNo:String(n).padStart(2,'0'), createdAt:Date.now(), updatedAt:Date.now() };
  db.products.unshift(copy); await saveDB();
  res.json({ ok:true, product:pubProduct(copy) });
});
app.delete('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  const i=db.products.findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({ error:'Product not found' });
  const [gone]=db.products.splice(i,1);
  // clean homepage refs
  const h=db.homepage;
  ['featuredIds','newIds','bestsellerIds'].forEach(k=>{ h[k]=(h[k]||[]).filter(id=>id!==gone.id); });
  await saveDB(); res.json({ ok:true });
});

/* ---------------- admin: categories ---------------- */
app.get('/api/admin/categories', requireAdmin, (req,res)=>{
  const counts={}; db.products.forEach(p=>p.categoryIds.forEach(c=>counts[c]=(counts[c]||0)+1));
  res.json({ categories: db.categories.slice().sort((a,b)=>(a.sort||0)-(b.sort||0)).map(c=>({...c, productCount:counts[c.id]||0})) });
});
app.post('/api/admin/categories', requireAdmin, async (req,res)=>{
  const name=String(req.body.name||'').trim();
  if(!name) return res.status(400).json({ error:'Category name is required' });
  let id=slugify(name);
  if(db.categories.some(c=>c.id===id)) id=id+'-'+Date.now().toString(36);
  const c={ id, slug:id, name, description:String(req.body.description||'').slice(0,500),
    image:String(req.body.image||''), sort:parseInt(req.body.sort)||db.categories.length+1,
    visible:req.body.visible!==false, createdAt:Date.now() };
  db.categories.push(c); await saveDB(); res.json({ ok:true, category:c });
});
app.put('/api/admin/categories/:id', requireAdmin, async (req,res)=>{
  const c=db.categories.find(x=>x.id===req.params.id);
  if(!c) return res.status(404).json({ error:'Category not found' });
  if(req.body.name && String(req.body.name).trim()) c.name=String(req.body.name).trim();
  if(req.body.description!==undefined) c.description=String(req.body.description).slice(0,500);
  if(req.body.image!==undefined) c.image=String(req.body.image);
  if(req.body.sort!==undefined) c.sort=parseInt(req.body.sort)||0;
  if(req.body.visible!==undefined) c.visible=!!req.body.visible;
  await saveDB(); res.json({ ok:true, category:c });
});
app.delete('/api/admin/categories/:id', requireAdmin, async (req,res)=>{
  const i=db.categories.findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({ error:'Category not found' });
  const [gone]=db.categories.splice(i,1);
  db.products.forEach(p=>p.categoryIds=p.categoryIds.filter(id=>id!==gone.id));
  db.homepage.collectionCategoryIds=(db.homepage.collectionCategoryIds||[]).filter(id=>id!==gone.id);
  await saveDB(); res.json({ ok:true });
});

/* ---------------- admin: orders ---------------- */
app.get('/api/admin/orders', requireAdmin, (req,res)=>{
  const { status, q } = req.query;
  let list=db.orders.slice();
  if(status) list=list.filter(o=>o.status===status);
  if(q){
    const n=String(q).toLowerCase();
    list=list.filter(o=>(o.id+' '+o.customer.name+' '+o.customer.mobile+' '+(o.trxId||'')).toLowerCase().includes(n));
  }
  res.json({ orders:list.map(sanitizeOrder), statuses:ORDER_STATUSES });
});
app.put('/api/admin/orders/:id', requireAdmin, async (req,res)=>{
  const o=db.orders.find(x=>x.id===req.params.id);
  if(!o) return res.status(404).json({ error:'Order not found' });
  const { status, paymentStatus, note } = req.body||{};
  const changes=[];
  if(status && ORDER_STATUSES.includes(status) && status!==o.status){
    if(o.status==='cancelled') return res.status(400).json({ error:'Cancelled orders cannot be changed' });
    if(status==='cancelled'){ // restore stock
      for(const it of o.items){
        const p=db.products.find(x=>x.id===it.productId);
        if(p){
          if(it.size && (p.sizes||[]).length){
            const row=p.sizes.find(x=>x.size.toLowerCase()===String(it.size).toLowerCase());
            if(row) row.stock+=it.qty;
            p.stock=p.sizes.reduce((t,x)=>t+x.stock,0);
          } else p.stock+=it.qty;
          p.sold=Math.max(0,(p.sold||0)-it.qty);
        }
      }
    }
    changes.push(`Status: ${o.status} → ${status}`);
    o.status=status;
  }
  if(paymentStatus && ['unpaid','pending-verification','paid','failed','refunded'].includes(paymentStatus) && paymentStatus!==o.paymentStatus){
    changes.push(`Payment: ${o.paymentStatus} → ${paymentStatus}`);
    o.paymentStatus=paymentStatus;
    if(paymentStatus==='paid' && o.status==='payment-pending'){ o.status='payment-verified'; changes.push('Status: payment-pending → payment-verified'); }
  }
  if(note && String(note).trim()) changes.push('Note: '+String(note).trim().slice(0,300));
  if(changes.length){ o.history.push({ at:Date.now(), by:'admin', text:changes.join(' | ') }); o.updatedAt=Date.now(); await saveDB(); }
  res.json({ ok:true, order:sanitizeOrder(o) });
});

/* ---------------- admin: customers / homepage / coupons / settings ---------------- */
app.get('/api/admin/customers', requireAdmin, (req,res)=>{
  const list=db.customers.map(c=>{
    const orders=db.orders.filter(o=>o.customer.customerId===c.id||o.customer.mobile===c.mobile);
    return { id:c.id,name:c.name,mobile:c.mobile,address:c.address,area:c.area,createdAt:c.createdAt,
      orders:orders.length, spent:orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.total,0) };
  });
  res.json({ customers:list });
});
app.get('/api/admin/homepage', requireAdmin, (req,res)=>{
  res.json({ homepage:db.homepage, products:db.products.map(p=>({id:p.id,name:p.name,cover:p.cover,published:p.published,stock:p.stock})), categories:db.categories });
});
app.put('/api/admin/homepage', requireAdmin, async (req,res)=>{
  const b=req.body||{}, h=db.homepage;
  const validIds=(arr)=> (Array.isArray(arr)?arr:[]).filter(id=>db.products.some(p=>p.id===id));
  if(b.hero) ['badge','title','line1','line2','line3','line3Italic','subtitle','ctaText','ctaLink','cta2Text','cta2Link','image'].forEach(k=>{ if(b.hero[k]!==undefined) h.hero[k]=String(b.hero[k]).slice(0,500); });
  if(b.featuredIds) h.featuredIds=validIds(b.featuredIds);
  if(b.newIds) h.newIds=validIds(b.newIds);
  if(b.bestsellerIds) h.bestsellerIds=validIds(b.bestsellerIds);
  if(b.collectionCategoryIds) h.collectionCategoryIds=b.collectionCategoryIds.filter(id=>db.categories.some(c=>c.id===id));
  if(b.perksTitle!==undefined) h.perksTitle=String(b.perksTitle).slice(0,200);
  if(b.showSections) Object.assign(h.showSections, b.showSections);
  await saveDB(); res.json({ ok:true, homepage:h });
});
app.get('/api/admin/coupons', requireAdmin, (req,res)=>res.json({ coupons:db.coupons }));
app.post('/api/admin/coupons', requireAdmin, async (req,res)=>{
  const code=String(req.body.code||'').toUpperCase().trim();
  if(!/^[A-Z0-9]{3,20}$/.test(code)) return res.status(400).json({ error:'Code must be 3-20 letters/numbers' });
  if(db.coupons.some(c=>c.code===code)) return res.status(400).json({ error:'Code already exists' });
  const c={ code, type:req.body.type==='flat'?'flat':'percent', value:Number(req.body.value)||0,
    minOrder:Number(req.body.minOrder)||0, active:req.body.active!==false, usage:0, createdAt:Date.now() };
  if(!(c.value>0)) return res.status(400).json({ error:'Discount value must be greater than 0' });
  db.coupons.push(c); await saveDB(); res.json({ ok:true, coupon:c });
});
app.put('/api/admin/coupons/:code', requireAdmin, async (req,res)=>{
  const c=db.coupons.find(x=>x.code===req.params.code);
  if(!c) return res.status(404).json({ error:'Coupon not found' });
  if(req.body.value!==undefined) c.value=Number(req.body.value)||c.value;
  if(req.body.minOrder!==undefined) c.minOrder=Number(req.body.minOrder)||0;
  if(req.body.active!==undefined) c.active=!!req.body.active;
  await saveDB(); res.json({ ok:true, coupon:c });
});
app.delete('/api/admin/coupons/:code', requireAdmin, async (req,res)=>{
  const i=db.coupons.findIndex(x=>x.code===req.params.code);
  if(i<0) return res.status(404).json({ error:'Coupon not found' });
  db.coupons.splice(i,1); await saveDB(); res.json({ ok:true });
});
app.get('/api/admin/settings', requireAdmin, (req,res)=>{
  const s=JSON.parse(JSON.stringify(db.settings));
  delete s.admin.passHash; delete s.admin.salt;
  delete s.sessionSecret;   // never expose the session signing key
  res.json({ settings:s });
});
app.put('/api/admin/settings', requireAdmin, async (req,res)=>{
  const b=req.body||{}, s=db.settings;
  if(b.brand) ['name','short','tagline','est'].forEach(k=>{ if(b.brand[k]!==undefined) s.brand[k]=String(b.brand[k]).slice(0,200); });
  if(b.contact) ['mobile','whatsapp','email','instagram','facebook','address'].forEach(k=>{ if(b.contact[k]!==undefined) s.contact[k]=String(b.contact[k]).slice(0,300); });
  if(b.delivery){ if(b.delivery.inside!==undefined) s.delivery.inside=Math.max(0,Number(b.delivery.inside)||0);
    if(b.delivery.outside!==undefined) s.delivery.outside=Math.max(0,Number(b.delivery.outside)||0);
    if(b.delivery.freeAbove!==undefined) s.delivery.freeAbove=Math.max(0,Number(b.delivery.freeAbove)||0);
    if(b.delivery.insideLabel) s.delivery.insideLabel=String(b.delivery.insideLabel).slice(0,60);
    if(b.delivery.outsideLabel) s.delivery.outsideLabel=String(b.delivery.outsideLabel).slice(0,60); }
  if(b.payments){
    if(b.payments.cod) s.payments.cod.enabled=!!b.payments.cod.enabled;
    ['bkash','nagad'].forEach(k=>{ if(b.payments[k]){ const t=s.payments[k],f=b.payments[k];
      if(f.enabled!==undefined) t.enabled=!!f.enabled;
      if(f.number!==undefined) t.number=String(f.number).slice(0,20);
      if(f.accountType!==undefined) t.accountType=String(f.accountType).slice(0,40);
      if(f.instruction!==undefined) t.instruction=String(f.instruction).slice(0,500); } });
  }
  if(b.seo){ if(b.seo.title!==undefined) s.seo.title=String(b.seo.title).slice(0,160);
    if(b.seo.description!==undefined) s.seo.description=String(b.seo.description).slice(0,320); }
  if(b.announcement!==undefined) s.announcement=String(b.announcement).slice(0,200);
  if(b.lowStockAt!==undefined) s.lowStockAt=Math.max(1,Number(b.lowStockAt)||5);
  await saveDB(); res.json({ ok:true });
});

/* ---------------- admin: analytics ---------------- */
app.get('/api/admin/analytics', requireAdmin, (req,res)=>{
  const days = Math.max(7, Math.min(90, parseInt(req.query.days)||30));
  const since = Date.now() - days*86400000;
  const paidish = o => o.status!=='cancelled';
  const inRange = db.orders.filter(o=>o.createdAt>=since);
  const series = [];
  for(let i=days-1;i>=0;i--){
    const d = new Date(Date.now()-i*86400000);
    const key = d.toISOString().slice(0,10);
    const dayStart = new Date(key+'T00:00:00').getTime();
    const dayOrders = db.orders.filter(o=>o.createdAt>=dayStart && o.createdAt<dayStart+86400000 && paidish(o));
    series.push({ date:key, orders:dayOrders.length, revenue:dayOrders.reduce((s,o)=>s+o.total,0) });
  }
  const byStatus={}; db.orders.forEach(o=>byStatus[o.status]=(byStatus[o.status]||0)+1);
  const byPayment={}; db.orders.forEach(o=>byPayment[o.paymentMethod]=(byPayment[o.paymentMethod]||0)+1);
  const byZone={inside:0,outside:0}; db.orders.forEach(o=>byZone[o.zone]=(byZone[o.zone]||0)+1);
  const byDistrict={}; db.orders.forEach(o=>{ const d=o.customer.district||'Unknown'; byDistrict[d]=(byDistrict[d]||0)+1; });
  const prodSales={};
  db.orders.filter(paidish).forEach(o=>o.items.forEach(it=>{
    const e=prodSales[it.productId]=prodSales[it.productId]||{ name:it.name, qty:0, revenue:0 };
    e.qty+=it.qty; e.revenue+=it.price*it.qty; }));
  const top=Object.values(prodSales).sort((a,b)=>b.qty-a.qty).slice(0,10);
  const valid=db.orders.filter(paidish);
  const revenue=valid.reduce((s,o)=>s+o.total,0);
  const delivered=db.orders.filter(o=>o.status==='delivered');
  res.json({
    range:{ days, orders:inRange.length, revenue:inRange.filter(paidish).reduce((s,o)=>s+o.total,0) },
    series, byStatus, byPayment, byZone,
    topDistricts:Object.entries(byDistrict).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,count])=>({name,count})),
    topProducts:top,
    totals:{ orders:db.orders.length, revenue, aov: valid.length?Math.round(revenue/valid.length):0,
      delivered:delivered.length, deliveredRevenue:delivered.reduce((s,o)=>s+o.total,0),
      cancelled:db.orders.filter(o=>o.status==='cancelled').length,
      customers:db.customers.length, products:db.products.length,
      views:db.products.reduce((s,p)=>s+(p.views||0),0) }
  });
});

/* ---------------- admin: reviews ---------------- */
app.get('/api/admin/reviews', requireAdmin, (req,res)=>{
  const names=Object.fromEntries(db.products.map(p=>[p.id,p.name]));
  const list=(db.reviews||[]).slice().sort((a,b)=>b.createdAt-a.createdAt)
    .map(r=>({ ...r, productName:names[r.productId]||'(deleted set)' }));
  res.json({ reviews:list, pending:list.filter(r=>!r.approved).length });
});
app.put('/api/admin/reviews/:id', requireAdmin, async (req,res)=>{
  const r=(db.reviews||[]).find(x=>x.id===req.params.id);
  if(!r) return res.status(404).json({ error:'Review not found' });
  if(req.body.approved!==undefined) r.approved=!!req.body.approved;
  if(req.body.text!==undefined) r.text=String(req.body.text).slice(0,600);
  await saveDB(); res.json({ ok:true, review:r });
});
app.delete('/api/admin/reviews/:id', requireAdmin, async (req,res)=>{
  const i=(db.reviews||[]).findIndex(x=>x.id===req.params.id);
  if(i<0) return res.status(404).json({ error:'Review not found' });
  db.reviews.splice(i,1); await saveDB(); res.json({ ok:true });
});

/* ---------------- admin: abandoned carts ---------------- */
app.get('/api/admin/carts', requireAdmin, (req,res)=>{
  const list=(db.carts||[]).filter(c=>!c.recovered).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,200);
  res.json({ carts:list, value:list.reduce((s,c)=>s+c.value,0) });
});
app.delete('/api/admin/carts/:key', requireAdmin, async (req,res)=>{
  db.carts=(db.carts||[]).filter(c=>c.key!==req.params.key); await saveDB(); res.json({ ok:true });
});

/* ---------------- admin: CMS content pages ---------------- */
app.get('/api/content/:key', (req,res)=>{
  const c=(db.content||{})[req.params.key];
  if(!c) return res.status(404).json({ error:'Page not found' });
  res.json(c);
});
app.get('/api/admin/content', requireAdmin, (req,res)=>res.json({ content: db.content||{} }));
app.put('/api/admin/content/:key', requireAdmin, async (req,res)=>{
  db.content=db.content||{};
  const cur=db.content[req.params.key]||{ title:'', body:'' };
  if(req.body.title!==undefined) cur.title=String(req.body.title).slice(0,160);
  if(req.body.body!==undefined) cur.body=String(req.body.body).slice(0,20000);
  cur.updatedAt=Date.now();
  db.content[req.params.key]=cur; await saveDB(); res.json({ ok:true, content:cur });
});

/* ---------------- admin: change credentials ---------------- */
app.post('/api/admin/password', requireAdmin, async (req,res)=>{
  const { currentPassword, newPassword, username } = req.body||{};
  const a = db.settings.admin;

  if(hash(String(currentPassword||''), a.salt)!==a.passHash){
    return res.status(400).json({ error:'Current password is incorrect' });
  }

  if(username && String(username).trim().length>=3){
    a.username = String(username).trim().slice(0,40);
  }

  if(newPassword){
    if(String(newPassword).length<6){
      return res.status(400).json({
        error:'New password must be at least 6 characters'
      });
    }

    a.salt = crypto.randomBytes(16).toString('hex');
    a.passHash = hash(String(newPassword), a.salt);

    // Revoke all existing admin access sessions
    db.revoked = db.revoked || {};
    Object.keys(db.sessions).forEach(t=>{
      if(db.sessions[t].type==='admin'){
        db.revoked[t] = Date.now();
        delete db.sessions[t];
      }
    });

    // Revoke all existing admin refresh grants
    // Refresh grants are signed separately and are not stored
    // in db.sessions, so revoke the currently supplied refresh grant.
    const c = parseCookies(req);
    const refreshToken =
      (req.body && req.body.refresh) ||
      req.headers['x-hss-refresh'] ||
      c.hss_admin_refresh;

    if(refreshToken){
      db.revoked[refreshToken] = Date.now();
    }

    // Clear both admin cookies immediately
    clearSessionCookie(req,res,'hss_admin_token');
    clearSessionCookie(req,res,'hss_admin_refresh');
  }

  await saveDB();

  res.json({
    ok:true,
    username:a.username,
    reloginRequired:!!newPassword
  });
});
/* ---------------- product image resizing (performance) ----------------
   Product images in Supabase Storage are ~1587×2245 px / ~1 MB each, but cards
   show them ~300 px wide — the homepage downloaded ~9 MB on mobile. /img
   returns a resized WebP/JPEG (≈90 KB at 600 w), resized once and cached on
   disk + in browsers. Only images from this shop's own Supabase bucket are
   accepted (no open proxy / SSRF) and only fixed widths. On any failure it
   redirects to the original image, so pictures never break. */
const IMG_WIDTHS = new Set([200, 400, 600, 900, 1200]);
const IMG_CACHE_DIR = process.env.HSS_IMG_CACHE_DIR || path.join(require('os').tmpdir(), 'hss-img-cache');
const IMG_INFLIGHT = new Map();
let imgActive = 0; const imgQueue = [];
const imgSlot = () => new Promise(r => { if(imgActive < 3){ imgActive++; r(); } else imgQueue.push(r); });
const imgDone = () => { const n = imgQueue.shift(); if(n) n(); else imgActive--; };
function allowedImageUrl(u){
  try{
    const x = new URL(u);
    let hostOk = /^[a-z0-9-]+\.supabase\.co$/.test(x.hostname);
    if(process.env.SUPABASE_URL){ try{ hostOk = x.hostname === new URL(process.env.SUPABASE_URL).hostname; }catch(_){} }
    return x.protocol === 'https:' && hostOk && !x.search && !x.username &&
      x.pathname.startsWith('/storage/v1/object/public/' + SUPABASE_BUCKET + '/') && !x.pathname.includes('..');
  }catch(_){ return false; }
}
async function renderImage(u, w, fmt, file){
  await imgSlot();
  try{
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if(!r.ok) throw new Error('origin HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if(buf.length > 25 * 1024 * 1024) throw new Error('origin image too large');
    const sharp = require('sharp');
    let img = sharp(buf, { limitInputPixels: 60e6 }).rotate().resize({ width: w, withoutEnlargement: true });
    img = fmt === 'webp' ? img.webp({ quality: 78 }) : img.jpeg({ quality: 80, mozjpeg: true });
    const out = await img.toBuffer();
    await fs.promises.mkdir(IMG_CACHE_DIR, { recursive: true });
    const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
    await fs.promises.writeFile(tmp, out);
    await fs.promises.rename(tmp, file);
  } finally { imgDone(); }
}
app.get('/img', async (req,res)=>{
  const u = String(req.query.u || '');
  const w = parseInt(req.query.w, 10);
  if(!allowedImageUrl(u) || !IMG_WIDTHS.has(w)) return res.status(400).type('text/plain').send('Bad image request');
  const fmt = /image\/webp/.test(req.headers.accept || '') ? 'webp' : 'jpeg';
  const key = crypto.createHash('sha1').update(u + '|' + w + '|' + fmt).digest('hex');
  const file = path.join(IMG_CACHE_DIR, key + '.' + fmt);
  try{
    if(!fs.existsSync(file)){
      let job = IMG_INFLIGHT.get(key);
      if(!job){ job = renderImage(u, w, fmt, file).finally(() => IMG_INFLIGHT.delete(key)); IMG_INFLIGHT.set(key, job); }
      await job;
    }
    res.setHeader('Vary', 'Accept');
    res.sendFile(file, { maxAge: '30d', immutable: true, headers: { 'Content-Type': fmt === 'webp' ? 'image/webp' : 'image/jpeg' } });
  }catch(e){
    console.warn('[img] falling back to original:', e && e.message);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, u);
  }
});

/* ---------------- admin: upload → Supabase Storage ---------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 8
  },
  fileFilter: (r, f, cb) =>
    /^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)
      ? cb(null, true)
      : cb(new Error('Only image files allowed'))
});

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.array('images', 8)(req, res, async err => {
    if (err) {
      return res.status(400).json({
        error: err.message || 'Upload failed'
      });
    }

    try {
      const files = req.files || [];

      if (!files.length) {
        return res.status(400).json({
          error: 'No image files received'
        });
      }

      const urls = [];

      for (const file of files) {
        const ext = MIME_EXT[file.mimetype] || '.jpg';   // validated by fileFilter

        const filename =
          Date.now().toString(36) +
          '-' +
          crypto.randomBytes(6).toString('hex') +
          ext;

        // Local development: keep uploads on this machine (public/uploads),
        // never in the production Supabase bucket.
        if (UPLOAD_STORAGE === 'local') {
          await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
          urls.push('/uploads/' + filename);
          continue;
        }

        const storagePath = `products/${filename}`;
        const supabase = getSupabase();

        const { error: uploadError } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });

        if (uploadError) {
          console.error('[supabase upload]', uploadError);

          return res.status(500).json({
            error: uploadError.message || 'Supabase upload failed'
          });
        }

        const { data: publicData } = supabase.storage
          .from(SUPABASE_BUCKET)
          .getPublicUrl(storagePath);

        urls.push(publicData.publicUrl);
      }

      res.json({
        ok: true,
        urls
      });

    } catch (e) {
      console.error('[supabase upload]', e);

      res.status(500).json({
        error: e && e.message
          ? e.message
          : 'Upload failed'
      });
    }
  });
});
/* ---------------- SEO ---------------- */
app.get('/robots.txt', (req,res)=>{
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: https://highstreet-society.onrender.com/mysites.xml\n');
});
function generateSitemap(req){
  const base=SITE_URL;   // same host as the canonical URLs
  const urls=['','/shop','/track','/about','/contact'].concat(Object.keys(db.content||{}).map(k=>'/policy/'+k));
  const xml=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  urls.forEach(u=>xml.push('<url><loc>'+base+(u||'/')+'</loc><changefreq>daily</changefreq></url>'));
  db.products.filter(p=>p.published).forEach(p=>xml.push('<url><loc>'+base+'/product/'+p.slug+'</loc><changefreq>weekly</changefreq></url>'));
  xml.push('</urlset>');
  return xml.join('\n');
}
app.get('/sitemap.xml',(req,res)=>{
  res.type('application/xml').send(generateSitemap(req));
});

app.get('/mysites.xml',(req,res)=>{
  res.type('application/xml').send(generateSitemap(req));
});

/* ---------------- pages ---------------- */
// Serve .webp automatically when the browser supports it (83% smaller images)
app.use((req,res,next)=>{
  if(/\.jpe?g$/i.test(req.url) && /image\/webp/.test(req.headers.accept||'')){
    const alt=req.url.replace(/\.jpe?g$/i,'.webp');
    if(fs.existsSync(path.join(__dirname,'public',alt.split('?')[0]))){
      req.url=alt; res.set('Vary','Accept');
    }
  }
  next();
});
app.use(express.static(path.join(__dirname,'public'), {
  index:false,                       // "/" is rendered by sendPage() below
  maxAge:'30d', etag:true,
  setHeaders:(res,fp)=>{
    // HTML must always revalidate.
    if(/\.html$/.test(fp)) return res.setHeader('Cache-Control','no-cache');
    // App code must revalidate too. Images/fonts keep the long cache.
    // Without this, a browser can run a 30-day-old admin.js and never pick up fixes.
    if(/\.(js|css)$/.test(fp)){
      // Cloudflare/edge caches were overriding a plain no-cache and serving
      // stale admin JS to browsers. Force revalidation everywhere.
      res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0, s-maxage=0, proxy-revalidate');
      res.setHeader('CDN-Cache-Control','no-store');
      res.setHeader('Cloudflare-CDN-Cache-Control','no-store');
      res.setHeader('Pragma','no-cache');
      res.setHeader('Expires','0');
      return;
    }
  }
}));
/* HTML pages: SEO metadata is filled in on the server, because social-preview
   crawlers (WhatsApp, Facebook) and some search bots do not run JavaScript.
   - absolute og:image URLs (relative ones are ignored by share previews)
   - canonical + og:url on public pages, noindex on private ones
   - product pages get their own title/description/image; unknown products 404 */
const SITE_URL = String(process.env.SITE_URL || 'https://highstreet-society.onrender.com').replace(/\/+$/, '');
const NOINDEX_PAGES = new Set(['cart.html','checkout.html','success.html','account.html','wishlist.html','admin.html','404.html','track.html']);
const htmlEsc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sendPage(req, res, file, { status = 200, meta = null } = {}){
  let html;
  try{ html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'); }
  catch(e){ return res.status(500).type('text/plain').send('Page unavailable'); }
  if(meta){
    const t = htmlEsc(meta.title), d = htmlEsc(meta.description);
    html = html.replace(/<title>[^<]*<\/title>/, '<title>' + t + '</title>')
      .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + d + '$2')
      .replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + t + '$2');
    if(meta.image) html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, '$1' + htmlEsc(meta.image) + '$2');
    if(!/property="og:description"/.test(html)) html = html.replace('</head>', '<meta property="og:description" content="' + d + '">\n</head>');
  }
  html = html.replace(/(<meta property="og:image" content=")\/(?!\/)/g, '$1' + SITE_URL + '/');
  const url = SITE_URL + req.path;
  const tags = NOINDEX_PAGES.has(file) ? '<meta name="robots" content="noindex">'
    : '<link rel="canonical" href="' + htmlEsc(url) + '">\n<meta property="og:url" content="' + htmlEsc(url) + '">';
  html = html.replace('</head>', tags + '\n</head>');
  res.status(status).type('html').setHeader('Cache-Control', 'no-cache');
  res.send(html);
}
const page = f => (req,res)=>sendPage(req, res, f);
app.get('/', page('index.html'));
app.get('/shop', page('shop.html'));
app.get('/product/:slug', (req,res)=>{
  const p = db.products.find(x => x.slug === req.params.slug && x.published);
  if(!p) return sendPage(req, res, 'product.html', { status:404 });   // page JS shows "not found"
  sendPage(req, res, 'product.html', { meta:{
    title: p.name + ' — Highstreet Society',
    description: ((p.short ? p.short + '. ' : '') + ((p.type||'poster') === 'poster' ? '6 premium A4 posters on 3mm board. ' : '') +
      'Cash on Delivery all over Bangladesh.').replace(/\.\.+/g, '.'),
    image: p.cover
  }});
});
app.get('/cart', page('cart.html'));
app.get('/checkout', page('checkout.html'));
app.get('/success', page('success.html'));
app.get('/track', page('track.html'));
app.get('/about', page('about.html'));
app.get('/contact', page('contact.html'));
app.get('/account', page('account.html'));
app.get('/wishlist', page('wishlist.html'));
app.get('/policy/:key', page('policy.html'));
app.get('/custom-design', page('custom-design.html'));
app.get('/admin', page('admin.html'));
app.use('/api', (req,res)=>res.status(404).json({ error:'Not found' }));
app.use((req,res)=>sendPage(req, res, '404.html', { status:404 }));

/* Bind the port only after the persistence layer is ready. If DATABASE_URL is
   configured but the approved PostgreSQL schema is missing, initialization
   fails before the HTTP server starts; data/db.json remains untouched. */
let server;
async function startServer(){
  const problems = localSafetyProblems();
  if(problems.length){
    problems.forEach(p => console.error('[fatal] ' + p));
    process.exit(1);
  }
  try{
    await initializePersistenceLayer();
    console.log('[hss] Environment:', IS_PRODUCTION ? 'production' : 'development',
      '| uploads:', UPLOAD_STORAGE,
      '| data:', persistence.mode === 'json' ? path.relative(__dirname, DB_PATH) : 'postgres');
    initializeSessionSecret();
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log('HSS running on http://0.0.0.0:' + PORT);
    });
    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`[fatal] Port ${PORT} is already in use by another process.`);
        console.error('[fatal] Stop it first:  pkill -f "node server.js"');
      } else {
        console.error('[fatal] Server failed to start:', err && err.message);
      }
      process.exit(1);
    });
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 70000;
  }catch(err){
    console.error('[fatal] Persistence initialization failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason && reason.stack ? reason.stack : reason);
});
function shutdown(sig) {
  console.log(`[hss] ${sig} received — closing server`);
  const code = process.env.HSS_STOP === '1' ? 0 : 130;
  if(!server) process.exit(code);
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
startServer();

