#!/usr/bin/env node
'use strict';

/*
 * Highstreet Society — READ-ONLY live catalog export.
 *
 * Writes a db.json-compatible snapshot of the live catalog to
 * data/db.live.json. It never writes to production and never touches
 * data/db.json or data/db.local.json.
 *
 * Two sources:
 *
 *   --source site   (default — NO credentials needed)
 *       Reads the public storefront API of the live site with plain GET
 *       requests, exactly like a visitor's browser: /api/settings,
 *       /api/categories, /api/products (paged), /api/homepage and
 *       /api/content/<key>. These handlers only read memory; the one public
 *       endpoint that writes (POST /api/products/:slug/view) is never called.
 *       Gives every PUBLISHED product and VISIBLE category.
 *       Base URL: --url, or HSS_EXPORT_BASE_URL, default
 *       https://highstreet-society.onrender.com
 *
 *   --source db
 *       Reads PostgreSQL directly (details below). Use this only if you also
 *       need unpublished drafts / hidden categories.
 *
 * ---- --source db ----
 *
 * Exported:   products, categories, product_categories (as product.categoryIds),
 *             homepage_config, content_pages, public store settings,
 *             hss_meta.productSeq (so locally-created products don't collide).
 * Excluded:   customers, orders, order_items, reviews, coupons, carts, designs,
 *             sessions, revoked_tokens, settings.admin (password hash/salt),
 *             settings.session_secret, and every other column not listed in
 *             the SELECTs below.
 *
 * Read-only enforcement:
 *   1. Connection string comes from HSS_EXPORT_DATABASE_URL — a variable the
 *      web server never reads, so setting it can't flip server.js into
 *      Postgres mode. DATABASE_URL is deliberately ignored.
 *   2. All queries run inside ONE transaction opened with
 *      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` (consistent snapshot,
 *      any write is rejected by PostgreSQL). The script verifies
 *      `transaction_read_only = on` before reading and always ROLLBACKs.
 *      No session-level SETs are used, so nothing leaks into a pooled
 *      (Supavisor/pgbouncer) backend shared with the live app.
 *   3. It checks whether the connected role has any write privilege and warns;
 *      pass --require-readonly-role to abort instead.
 *
 * Recommended dedicated role (run once in the Supabase SQL editor, as admin):
 *
 *   CREATE ROLE hss_catalog_reader LOGIN PASSWORD '<strong password>';
 *   ALTER ROLE hss_catalog_reader SET default_transaction_read_only = on;
 *   GRANT USAGE ON SCHEMA public TO hss_catalog_reader;
 *   GRANT SELECT ON products, categories, product_categories,
 *                   homepage_config, content_pages, hss_meta TO hss_catalog_reader;
 *   GRANT SELECT (id, brand, contact, delivery, payments, seo, announcement, low_stock_at)
 *     ON app_settings TO hss_catalog_reader;      -- column grant: no admin / session_secret
 *   -- If RLS is enabled on these tables, also add SELECT policies for this role
 *   -- (or the export will see 0 rows).
 *
 * Usage:
 *   npm run export:catalog                                    (public site, no credentials)
 *   HSS_EXPORT_DATABASE_URL='postgresql://...' node scripts/export-live-catalog.js --source db
 *   Options:
 *     --source site|db          where to read from (default site)
 *     --url <base url>          live site for --source site
 *     --out <path>              output file (default data/db.live.json; db.json refused)
 *     --require-readonly-role   abort if the role has INSERT/UPDATE/DELETE/TRUNCATE
 *     --local-admin             copy settings.admin from LOCAL data/db.json (demo login)
 *                               so the local admin panel works with the snapshot
 *     --dry-run                 query + validate, but don't write a file
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'data', 'db.live.json');
const PROTECTED_FILES = ['db.json', 'db.backup.json', 'db.local.json'].map(f => path.join(ROOT, 'data', f));
const ENV_VAR = 'HSS_EXPORT_DATABASE_URL';
const DEFAULT_SITE = 'https://highstreet-society.onrender.com';
// Content page keys linked from the storefront footer (public/js/store.js).
const CONTENT_KEYS = ['shipping', 'returns', 'privacy', 'terms', 'faq'];

const CATALOG_TABLES = ['products', 'categories', 'product_categories', 'homepage_config',
  'content_pages', 'app_settings', 'hss_meta'];

// Key names that must never appear anywhere in the output.
const FORBIDDEN_KEYS = ['passHash', 'pass_hash', 'salt', 'sessionSecret', 'session_secret',
  'trxId', 'trx_id', 'password', 'token'];

/* Explicit column lists — never SELECT *. */
const SQL = {
  products: `SELECT id, slug, set_no, views, sold, created_at, updated_at, name, short, description,
               price, sale_price, stock, sku, tags, cover, posters, type, sizes, bundle_items,
               poster_size, board_thickness, featured, is_new, bestseller, published,
               allow_backorder, sort, seo_title, seo_desc
             FROM products ORDER BY sort ASC, created_at DESC`,
  categories: `SELECT id, slug, name, description, image, sort, visible, created_at
               FROM categories ORDER BY sort ASC, created_at ASC`,
  productCategories: `SELECT product_id, category_id FROM product_categories`,
  homepage: `SELECT hero, featured_ids, new_ids, bestseller_ids, collection_category_ids,
               perks_title, show_sections
             FROM homepage_config WHERE id = 1`,
  content: `SELECT page_key, title, body, updated_at FROM content_pages`,
  // admin and session_secret are intentionally NOT selected.
  settings: `SELECT brand, contact, delivery, payments, seo, announcement, low_stock_at
             FROM app_settings WHERE id = 1`,
  productSeq: `SELECT value FROM hss_meta WHERE key = 'productSeq'`
};

/* ---------------- helpers ---------------- */
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const str = v => (v === null || v === undefined) ? '' : String(v);
function dateToMs(v) {
  if (v === null || v === undefined) return undefined;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** Remove anything that looks like a connection string or the password from a message. */
function redact(message, connStr) {
  let m = String(message || '');
  if (connStr) {
    m = m.split(connStr).join('[redacted-url]');
    try {
      const u = new URL(connStr);
      if (u.password) m = m.split(decodeURIComponent(u.password)).join('[redacted]').split(u.password).join('[redacted]');
      if (u.username) m = m.split(decodeURIComponent(u.username)).join('[user]');
    } catch (_) { /* not a parseable URL */ }
  }
  return m.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-url]');
}

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, source: 'site', url: process.env.HSS_EXPORT_BASE_URL || DEFAULT_SITE,
    requireReadonlyRole: false, localAdmin: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i] || '');
    else if (a === '--source') opts.source = String(argv[++i] || '');
    else if (a === '--url') opts.url = String(argv[++i] || '');
    else if (a === '--require-readonly-role') opts.requireReadonlyRole = true;
    else if (a === '--local-admin') opts.localAdmin = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!['site', 'db'].includes(opts.source)) throw new Error('--source must be "site" or "db"');
  if (opts.source === 'site') {
    const u = new URL(opts.url);   // throws on garbage
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
      throw new Error('--url must be https (or localhost)');
    }
    opts.url = u.origin;
  }
  return opts;
}

function assertSafeOutputPath(out) {
  const resolved = path.resolve(out);
  const norm = p => path.resolve(p).toLowerCase(); // Windows paths are case-insensitive
  if (PROTECTED_FILES.some(p => norm(p) === norm(resolved))) {
    throw new Error(`Refusing to write to ${path.relative(ROOT, resolved)} — choose a different --out path.`);
  }
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error('Output path must end in .json');
  }
  return resolved;
}

/* ---------------- row mapping (mirrors db-postgres.js loadState) ---------------- */
function mapCategory(r) {
  return { id: r.id, slug: r.slug, name: r.name, description: str(r.description), image: str(r.image),
    sort: Number(r.sort || 0), visible: r.visible !== false, createdAt: dateToMs(r.created_at) };
}

function mapProduct(r, catMap) {
  return {
    id: r.id, slug: r.slug, setNo: str(r.set_no), views: Number(r.views || 0), sold: Number(r.sold || 0),
    createdAt: dateToMs(r.created_at), updatedAt: dateToMs(r.updated_at), name: r.name,
    short: str(r.short), description: str(r.description), price: Number(r.price || 0),
    salePrice: (r.sale_price === null || r.sale_price === undefined) ? null : Number(r.sale_price),
    stock: Number(r.stock || 0), sku: str(r.sku), categoryIds: catMap[r.id] || [],
    tags: arr(r.tags), cover: str(r.cover), posters: arr(r.posters),   // image URLs kept verbatim
    type: r.type || 'poster', sizes: arr(r.sizes), bundleItems: arr(r.bundle_items),
    posterSize: r.poster_size || 'A4', boardThickness: r.board_thickness || '3mm',
    featured: !!r.featured, isNew: !!r.is_new, bestseller: !!r.bestseller, published: !!r.published,
    allowBackorder: !!r.allow_backorder, sort: Number(r.sort || 0),
    seoTitle: str(r.seo_title), seoDesc: str(r.seo_desc)
  };
}

function mapHomepage(r) {
  if (!r) return {};
  return { hero: obj(r.hero), featuredIds: arr(r.featured_ids), newIds: arr(r.new_ids),
    bestsellerIds: arr(r.bestseller_ids), collectionCategoryIds: arr(r.collection_category_ids),
    perksTitle: str(r.perks_title), showSections: obj(r.show_sections) };
}

/** Whitelist public settings field-by-field (same fields server.js publicSettings() exposes). */
function mapSettings(r) {
  const s = r || {};
  const contact = obj(s.contact);
  const payments = obj(s.payments);
  const pay = (p, withNumber) => {
    const o = obj(p);
    const out = { enabled: !!o.enabled };
    if (withNumber) {
      out.number = str(o.number); out.accountType = str(o.accountType); out.instruction = str(o.instruction);
    }
    return out;
  };
  return {
    brand: obj(s.brand),
    contact: { mobile: str(contact.mobile), whatsapp: str(contact.whatsapp), email: str(contact.email),
      instagram: str(contact.instagram), facebook: str(contact.facebook), address: str(contact.address) },
    delivery: obj(s.delivery),
    payments: { cod: pay(payments.cod, false), bkash: pay(payments.bkash, true), nagad: pay(payments.nagad, true) },
    seo: obj(s.seo),
    announcement: str(s.announcement),
    lowStockAt: Number(s.low_stock_at || s.lowStockAt || 5),
    // No admin credentials and no session secret. With admin = {}, local admin
    // login simply returns 401; server.js generates its own session secret.
    admin: {}
  };
}

/**
 * Pure transform: raw query rows -> db.json-compatible object.
 * Private collections are present but always empty so server.js can load it.
 */
function buildSnapshot(rows, { exportedAt = Date.now() } = {}) {
  const catMap = {};
  for (const r of arr(rows.productCategories)) (catMap[r.product_id] ||= []).push(r.category_id);
  const products = arr(rows.products).map(r => mapProduct(r, catMap));
  const categories = arr(rows.categories).map(mapCategory);
  const content = {};
  for (const r of arr(rows.content)) {
    content[r.page_key] = { title: str(r.title), body: str(r.body), updatedAt: dateToMs(r.updated_at) };
  }
  const seqRow = arr(rows.productSeq)[0];
  return assembleSnapshot({
    source: 'live-postgres', exportedAt,
    includes: ['products', 'categories', 'product_categories', 'homepage_config', 'content_pages',
      'public settings', 'meta.productSeq'],
    products, categories, content,
    settings: mapSettings(arr(rows.settings)[0]),
    homepage: mapHomepage(arr(rows.homepage)[0]),
    productSeq: Number(seqRow && seqRow.value) || 0
  });
}

/* server.js creates ids as 'p' + productSeq + 4 hex chars (e.g. p1978b56 = seq 197).
   Return the highest sequence number used, so locally created products never collide. */
function maxProductSeq(products) {
  return arr(products).reduce((m, p) => {
    const match = /^p(\d+)[0-9a-f]{4}$/i.exec(String(p.id)) || /^p(\d+)$/i.exec(String(p.id));
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
}

function assembleSnapshot({ source, exportedAt = Date.now(), includes, products, categories, content,
  settings, homepage, productSeq = 0 }) {
  return {
    _export: {
      source,
      exportedAt: new Date(exportedAt).toISOString(),
      readOnly: true,
      includes,
      excludes: ['customers', 'orders', 'order_items', 'reviews', 'coupons', 'carts', 'designs',
        'sessions', 'revoked_tokens', 'settings.admin', 'settings.sessionSecret']
    },
    meta: { orderSeq: 1001, productSeq: Math.max(180, Number(productSeq) || 0, maxProductSeq(products) + 1),
      customerSeq: 1, designSeq: 1001 },
    settings,
    categories,
    products,
    customers: [], sessions: {}, designs: [], orders: [], reviews: [], carts: [],
    content,
    coupons: [],
    homepage,
    revoked: {}
  };
}

/* ---------------- --source site: public storefront API ---------------- */
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
const PRODUCT_FIELDS = ['id', 'slug', 'setNo', 'name', 'short', 'description', 'price', 'salePrice', 'stock', 'sku',
  'categoryIds', 'tags', 'cover', 'posters', 'type', 'sizes', 'bundleItems', 'posterSize', 'boardThickness',
  'featured', 'isNew', 'bestseller', 'published', 'allowBackorder', 'sold', 'views', 'sort', 'seoTitle', 'seoDesc',
  'createdAt', 'updatedAt'];
const CATEGORY_FIELDS = ['id', 'slug', 'name', 'description', 'image', 'sort', 'visible', 'createdAt'];

/** GET-only JSON fetcher restricted to the public storefront endpoints. */
function makeSiteGetter(baseUrl, fetchImpl = globalThis.fetch) {
  const ALLOWED = /^\/api\/(settings|categories|homepage|products|content\/[a-z0-9-]+)(\?|$)/;
  return async function get(pathAndQuery, { allow404 = false } = {}) {
    if (!ALLOWED.test(pathAndQuery)) throw new Error(`Refusing non-catalog endpoint ${pathAndQuery}`);
    const res = await fetchImpl(baseUrl + pathAndQuery, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'hss-catalog-export/1.0 (read-only)' },
      signal: AbortSignal.timeout(120000)   // Render free instances can take ~1 min to wake
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${pathAndQuery} -> HTTP ${res.status}`);
    return res.json();
  };
}

async function fetchSiteCatalog(baseUrl, { fetchImpl, log = () => {} } = {}) {
  const get = makeSiteGetter(baseUrl, fetchImpl);
  const settings = await get('/api/settings');
  const categories = await get('/api/categories');
  const products = [];
  for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
    const r = await get(`/api/products?limit=60&sort=manual&page=${page}`);
    products.push(...arr(r.items));
    pages = Number(r.pages) || 1;
  }
  const homepage = await get('/api/homepage');
  const content = {};
  for (const key of CONTENT_KEYS) {
    const c = await get('/api/content/' + key, { allow404: true });
    if (c) content[key] = { title: str(c.title), body: str(c.body), updatedAt: c.updatedAt };
  }
  log('info', `Fetched ${products.length} products, ${arr(categories).length} categories, ` +
    `${Object.keys(content).length} content pages from ${baseUrl}`);
  return { settings, categories, products, homepage, content };
}

/** Pure transform: public API responses -> db.json-compatible snapshot. */
function buildSnapshotFromSite(site, { exportedAt = Date.now(), baseUrl = DEFAULT_SITE } = {}) {
  const ids = list => arr(list).map(p => p && p.id).filter(Boolean);
  const h = obj(site.homepage);
  return assembleSnapshot({
    source: 'live-site-public-api ' + baseUrl, exportedAt,
    includes: ['published products', 'visible categories', 'homepage', 'content pages', 'public settings'],
    products: arr(site.products).map(p => ({ ...pick(p, PRODUCT_FIELDS),
      categoryIds: arr(p.categoryIds), tags: arr(p.tags), posters: arr(p.posters), sizes: arr(p.sizes),
      bundleItems: arr(p.bundleItems), salePrice: p.salePrice == null ? null : Number(p.salePrice),
      price: Number(p.price) })),
    categories: arr(site.categories).map(c => pick(c, CATEGORY_FIELDS)),
    content: obj(site.content),
    settings: mapSettings(site.settings),
    homepage: { hero: obj(h.hero), featuredIds: ids(h.featured), newIds: ids(h.newArrivals),
      bestsellerIds: ids(h.bestsellers), collectionCategoryIds: ids(h.collections),
      perksTitle: str(h.perksTitle), showSections: obj(h.showSections) }
  });
}

/* ---------------- validation ---------------- */
function findForbiddenKeys(value, trail = '$', hits = []) {
  if (Array.isArray(value)) value.forEach((v, i) => findForbiddenKeys(v, `${trail}[${i}]`, hits));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k)) hits.push(`${trail}.${k}`);
      findForbiddenKeys(v, `${trail}.${k}`, hits);
    }
  }
  return hits;
}

function classifyImage(url) {
  if (!url) return 'empty';
  if (/^https:\/\/[^/]+\.supabase\.co\/storage\//i.test(url)) return 'supabase';
  if (/^https?:\/\//i.test(url)) return 'external';
  if (url.startsWith('/uploads/')) return 'local-upload';
  if (url.startsWith('/images/')) return 'local-static';
  return 'other';
}

/** Returns { errors, warnings, stats }. Errors mean the snapshot must not be written. */
function validateSnapshot(db, { allowAdmin = false } = {}) {
  const errors = [];
  const warnings = [];
  const required = ['meta', 'settings', 'categories', 'products', 'customers', 'sessions', 'designs',
    'orders', 'reviews', 'carts', 'content', 'coupons', 'homepage', 'revoked'];
  for (const k of required) if (!(k in db)) errors.push(`missing top-level key "${k}"`);

  for (const k of ['customers', 'designs', 'orders', 'reviews', 'carts', 'coupons']) {
    if (arr(db[k]).length) errors.push(`private collection "${k}" is not empty`);
  }
  for (const k of ['sessions', 'revoked']) {
    if (Object.keys(obj(db[k])).length) errors.push(`private collection "${k}" is not empty`);
  }
  if (db.settings && 'sessionSecret' in db.settings) errors.push('settings.sessionSecret present');
  if (!allowAdmin && Object.keys(obj(db.settings && db.settings.admin)).length) {
    errors.push('settings.admin contains credentials');
  }
  let hits = findForbiddenKeys(db);
  if (allowAdmin) hits = hits.filter(h => !h.startsWith('$.settings.admin.'));
  for (const h of hits) errors.push(`forbidden key at ${h}`);

  const s = obj(db.settings);
  for (const p of ['cod', 'bkash', 'nagad']) {
    if (!s.payments || !s.payments[p]) errors.push(`settings.payments.${p} missing (server.js publicSettings would crash)`);
  }
  if (!s.contact) errors.push('settings.contact missing');

  const ids = new Set(), slugs = new Set();
  const catIds = new Set(arr(db.categories).map(c => c.id));
  const images = {};
  const countImg = u => { const c = classifyImage(u); images[c] = (images[c] || 0) + 1; };
  for (const p of arr(db.products)) {
    if (!p.id || !p.slug || !p.name) errors.push(`product missing id/slug/name: ${JSON.stringify(p.id)}`);
    if (ids.has(p.id)) errors.push(`duplicate product id ${p.id}`);
    if (slugs.has(p.slug)) errors.push(`duplicate product slug ${p.slug}`);
    ids.add(p.id); slugs.add(p.slug);
    if (!Number.isFinite(p.price)) errors.push(`product ${p.id} has non-numeric price`);
    if (p.salePrice !== null && !Number.isFinite(p.salePrice)) errors.push(`product ${p.id} has invalid salePrice`);
    for (const c of arr(p.categoryIds)) if (!catIds.has(c)) warnings.push(`product ${p.id} references unknown category ${c}`);
    countImg(p.cover);
    arr(p.posters).forEach(countImg);
  }
  if (!arr(db.products).length) {
    warnings.push('0 products exported — wrong database, or RLS is hiding rows from this role?');
  }
  if (images['local-upload']) {
    warnings.push(`${images['local-upload']} image(s) point to /uploads/ on the live server; they won't exist locally`);
  }

  return { errors, warnings, stats: {
    products: arr(db.products).length,
    publishedProducts: arr(db.products).filter(p => p.published).length,
    categories: arr(db.categories).length,
    productCategoryLinks: arr(db.products).reduce((n, p) => n + arr(p.categoryIds).length, 0),
    contentPages: Object.keys(obj(db.content)).length,
    homepageConfigured: Object.keys(obj(db.homepage)).length > 0,
    images
  } };
}

/* ---------------- database access ---------------- */
async function checkRolePrivileges(client) {
  const { rows } = await client.query(`
    SELECT t AS table_name,
           has_table_privilege(current_user, t, 'INSERT')   AS ins,
           has_table_privilege(current_user, t, 'UPDATE')   AS upd,
           has_table_privilege(current_user, t, 'DELETE')   AS del,
           has_table_privilege(current_user, t, 'TRUNCATE') AS trn
    FROM unnest($1::text[]) AS t
    WHERE to_regclass('public.' || t) IS NOT NULL`, [CATALOG_TABLES]);
  return rows.filter(r => r.ins || r.upd || r.del || r.trn).map(r => r.table_name);
}

/**
 * Runs every query inside one READ ONLY transaction and always rolls back.
 * `client` is a connected pg.Client (or a test double with the same query()).
 */
async function readCatalog(client, { requireReadonlyRole = false, log = () => {} } = {}) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const ro = await client.query('SHOW transaction_read_only');
    const flag = ro.rows && ro.rows[0] && String(ro.rows[0].transaction_read_only).toLowerCase();
    if (flag !== 'on') throw new Error('Could not confirm a read-only transaction; aborting before reading any data.');
    await client.query("SET LOCAL statement_timeout = '30s'");   // transaction-scoped only

    const writable = await checkRolePrivileges(client);
    if (writable.length) {
      const msg = `Connected role has write privileges on: ${writable.join(', ')}. ` +
        'The transaction is still READ ONLY, but a dedicated read-only role is recommended.';
      if (requireReadonlyRole) throw new Error(msg + ' (--require-readonly-role set)');
      log('warn', msg);
    } else {
      log('info', 'Connected role has no write privileges on catalog tables.');
    }

    const rows = {};
    for (const [key, sql] of Object.entries(SQL)) {
      rows[key] = (await client.query(sql)).rows;
    }
    return rows;
  } finally {
    // Nothing was written, but ROLLBACK (never COMMIT) on every path.
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be gone */ }
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readLocalAdmin() {
  const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  const a = obj(local.settings && local.settings.admin);
  if (!a.username || !a.salt || !a.passHash) throw new Error('data/db.json has no local admin credentials to copy.');
  return { username: a.username, salt: a.salt, passHash: a.passHash };
}

/* ---------------- CLI ---------------- */
async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const out = assertSafeOutputPath(opts.out);
  const log = (level, msg) => console[level === 'warn' ? 'warn' : 'log'](`[export] ${level === 'warn' ? 'WARNING: ' : ''}${msg}`);
  const snapshot = opts.source === 'site'
    ? buildSnapshotFromSite(await fetchSiteCatalog(opts.url, { log }), { baseUrl: opts.url })
    : buildSnapshot(await readFromDatabase(opts, log));
  return finish(snapshot, opts, out, log);
}

async function readFromDatabase(opts, log) {
  // Load .env only for HSS_EXPORT_DATABASE_URL; never print it.
  try { require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true }); } catch (_) {}
  const connStr = process.env[ENV_VAR];
  if (!connStr) {
    throw new Error(`${ENV_VAR} is not set. (DATABASE_URL is intentionally ignored by this script.)`);
  }
  const { Client } = require('pg');
  const client = new Client({
    connectionString: connStr,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    application_name: 'hss-catalog-export-readonly'
  });

  let rows;
  try {
    log('info', 'Connecting (credentials hidden)…');
    await client.connect();
    rows = await readCatalog(client, { requireReadonlyRole: opts.requireReadonlyRole, log });
  } catch (err) {
    throw new Error(redact(err && err.message, connStr));
  } finally {
    try { await client.end(); } catch (_) {}
  }
  return rows;
}

function finish(snapshot, opts, out, log) {
  if (opts.localAdmin) {
    snapshot.settings.admin = readLocalAdmin();
    snapshot._export.localAdmin = 'settings.admin copied from local data/db.json (not from production)';
  }

  const { errors, warnings, stats } = validateSnapshot(snapshot, { allowAdmin: opts.localAdmin });
  warnings.forEach(w => log('warn', w));
  log('info', 'Stats: ' + JSON.stringify(stats));
  if (errors.length) {
    errors.forEach(e => console.error('[export] ERROR: ' + e));
    throw new Error('Validation failed — nothing was written.');
  }

  if (opts.dryRun) { log('info', 'Dry run: no file written.'); return; }
  writeJsonAtomic(out, snapshot);
  log('info', `Wrote ${path.relative(ROOT, out)} (data/db.json untouched).`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[export] Failed:', redact(err && err.message));
    process.exit(1);
  });
}

module.exports = { buildSnapshot, buildSnapshotFromSite, fetchSiteCatalog, makeSiteGetter, maxProductSeq,
  validateSnapshot, readCatalog, assertSafeOutputPath, redact, classifyImage, findForbiddenKeys, parseArgs,
  main, SQL, FORBIDDEN_KEYS, CONTENT_KEYS };
