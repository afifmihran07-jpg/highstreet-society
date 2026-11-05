'use strict';
/* Offline tests for scripts/export-live-catalog.js — no database needed.
   Run: node --test tests/export-live-catalog.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ex = require('../scripts/export-live-catalog');

const ROOT = path.join(__dirname, '..');
const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
const SUPA = 'https://abcxyz.supabase.co/storage/v1/object/public/product-images/products/m1-aa.jpg';

/* Turn the local demo db.json into Postgres-shaped rows, plus deliberately
   hostile extras (admin hash, session secret) to prove they never leak. */
function pgRows() {
  const d = new Date(1787514463677);
  const products = local.products.map((p, i) => ({
    id: p.id, slug: p.slug, set_no: p.setNo || '', views: String(p.views || 0), sold: String(p.sold || 0),
    created_at: d, updated_at: d, name: p.name, short: p.short, description: p.description,
    price: String(p.price) + '.00', sale_price: p.salePrice == null ? null : String(p.salePrice) + '.00',
    stock: p.stock, sku: p.sku, tags: p.tags, cover: i === 0 ? SUPA : p.cover,
    posters: i === 0 ? [SUPA, SUPA] : p.posters, type: p.type, sizes: p.sizes || [],
    bundle_items: p.bundleItems || [], poster_size: p.posterSize, board_thickness: p.boardThickness,
    featured: p.featured, is_new: p.isNew, bestseller: p.bestseller, published: p.published,
    allow_backorder: !!p.allowBackorder, sort: p.sort || 0, seo_title: '', seo_desc: ''
  }));
  return {
    products,
    categories: local.categories.map(c => ({ ...c, created_at: d })),
    productCategories: local.products.flatMap(p => (p.categoryIds || []).map(c => ({ product_id: p.id, category_id: c }))),
    homepage: [{ hero: local.homepage.hero, featured_ids: local.homepage.featuredIds, new_ids: local.homepage.newIds,
      bestseller_ids: local.homepage.bestsellerIds, collection_category_ids: local.homepage.collectionCategoryIds,
      perks_title: local.homepage.perksTitle, show_sections: local.homepage.showSections }],
    content: Object.entries(local.content).map(([k, v]) => ({ page_key: k, title: v.title, body: v.body, updated_at: d })),
    settings: [{ ...local.settings, low_stock_at: 5,
      admin: { username: 'x', salt: 's', passHash: 'h' }, session_secret: 'SECRET',
      contact: { ...local.settings.contact, privateNote: 'nope' } }],
    productSeq: [{ value: '185' }]
  };
}

/* Fake pg client: enforces that only read statements run, inside a READ ONLY txn. */
function fakeClient({ readOnlyFlag = 'on', writable = [] } = {}) {
  const rows = pgRows();
  const bySql = new Map(Object.entries(ex.SQL).map(([k, sql]) => [sql, rows[k]]));
  const log = [];
  return {
    log,
    async query(sql) {
      const s = sql.trim();
      log.push(s.split(/\s+/).slice(0, 3).join(' '));
      if (/^(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|COMMIT)\b/i.test(s)) throw new Error('WRITE ATTEMPTED: ' + s);
      if (/^SET\s+(?!LOCAL)/i.test(s)) throw new Error('session-level SET used: ' + s);
      if (/^BEGIN/i.test(s)) { assert.match(s, /READ ONLY/); return { rows: [] }; }
      if (/^ROLLBACK/i.test(s) || /^SET LOCAL/i.test(s)) return { rows: [] };
      if (/^SHOW transaction_read_only/i.test(s)) return { rows: [{ transaction_read_only: readOnlyFlag }] };
      if (/has_table_privilege/.test(s)) return { rows: writable.map(t => ({ table_name: t, ins: true, upd: false, del: false, trn: false })) };
      if (bySql.has(sql)) return { rows: bySql.get(sql) };
      throw new Error('unexpected query: ' + s.slice(0, 60));
    }
  };
}

test('reads inside a READ ONLY transaction and always rolls back', async () => {
  const c = fakeClient();
  await ex.readCatalog(c);
  assert.match(c.log[0], /^BEGIN/);
  assert.equal(c.log.at(-1), 'ROLLBACK');
  assert.ok(!c.log.some(l => /COMMIT/i.test(l)));
});

test('aborts before reading data if the transaction is not read-only', async () => {
  const c = fakeClient({ readOnlyFlag: 'off' });
  await assert.rejects(ex.readCatalog(c), /read-only/);
  assert.ok(!c.log.some(l => /^SELECT id, slug/.test(l)), 'no catalog query ran');
  assert.equal(c.log.at(-1), 'ROLLBACK');
});

test('warns on writable role; aborts with --require-readonly-role', async () => {
  const warnings = [];
  await ex.readCatalog(fakeClient({ writable: ['products'] }), { log: (l, m) => l === 'warn' && warnings.push(m) });
  assert.equal(warnings.length, 1);
  await assert.rejects(ex.readCatalog(fakeClient({ writable: ['products'] }), { requireReadonlyRole: true }), /write privileges/);
});

test('snapshot keeps catalog + Supabase URLs and excludes all private data', async () => {
  const rows = await ex.readCatalog(fakeClient());
  const snap = ex.buildSnapshot(rows);
  const json = JSON.stringify(snap);

  assert.equal(snap.products.length, local.products.length);
  assert.equal(snap.categories.length, local.categories.length);
  assert.equal(snap.products[0].cover, SUPA);
  assert.deepEqual(snap.products[0].posters, [SUPA, SUPA]);
  assert.equal(typeof snap.products[1].price, 'number');
  assert.deepEqual(snap.products.find(p => p.id === 'p01').categoryIds, local.products.find(p => p.id === 'p01').categoryIds);
  assert.deepEqual(Object.keys(snap.content).sort(), Object.keys(local.content).sort());
  assert.ok(snap.meta.productSeq >= 185);

  assert.deepEqual(snap.settings.admin, {});
  assert.ok(!('sessionSecret' in snap.settings));
  assert.ok(!json.includes('SECRET') && !json.includes('passHash') && !json.includes('privateNote'));
  for (const k of ['customers', 'orders', 'reviews', 'carts', 'designs', 'coupons']) assert.deepEqual(snap[k], []);

  const v = ex.validateSnapshot(snap);
  assert.deepEqual(v.errors, []);
  assert.equal(v.stats.images.supabase, 3);
});

test('validator catches leaked secrets and private rows', () => {
  const snap = ex.buildSnapshot(pgRows());
  snap.orders.push({ id: 'o1' });
  snap.settings.sessionSecret = 'x';
  snap.products[0].passHash = 'h';
  const { errors } = ex.validateSnapshot(snap);
  assert.ok(errors.some(e => /orders/.test(e)));
  assert.ok(errors.some(e => /sessionSecret/.test(e)));
  assert.ok(errors.some(e => /passHash/.test(e)));
});

test('missing settings row still yields a server-safe settings shape', () => {
  const snap = ex.buildSnapshot({ products: [], categories: [] });
  assert.deepEqual(ex.validateSnapshot(snap).errors, []);
  assert.equal(snap.settings.payments.bkash.enabled, false);
});

test('refuses to overwrite data/db.json or the backup', () => {
  assert.throws(() => ex.assertSafeOutputPath(path.join(ROOT, 'data', 'db.json')), /Refusing/);
  assert.throws(() => ex.assertSafeOutputPath(path.join(ROOT, 'DATA', 'DB.JSON')), /Refusing/);
  assert.throws(() => ex.assertSafeOutputPath(path.join(ROOT, 'data', 'db.backup.json')), /Refusing/);
  assert.ok(ex.assertSafeOutputPath(path.join(os.tmpdir(), 'x.json')));
});

test('redacts connection strings and passwords', () => {
  const url = 'postgresql://reader:p%40ss@db.host.supabase.co:5432/postgres';
  const msg = ex.redact(`failed for ${url} (password p@ss, user reader)`, url);
  assert.ok(!msg.includes('p@ss') && !msg.includes('p%40ss') && !msg.includes(url));
  assert.ok(!ex.redact('x postgres://a:b@c/d y').includes('a:b@'));
});

test('CLI exits with an error when HSS_EXPORT_DATABASE_URL is unset (ignores DATABASE_URL)', () => {
  const { spawnSync } = require('child_process');
  const env = { ...process.env, DATABASE_URL: 'postgresql://should:not@be.used/x' };
  delete env.HSS_EXPORT_DATABASE_URL;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'export-live-catalog.js'), '--source', 'db', '--dry-run'],
    { env, encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HSS_EXPORT_DATABASE_URL is not set/);
  assert.ok(!r.stderr.includes('should:not'));
});

/* ---------------- --source site (public storefront API) ---------------- */
function fakeSiteFetch() {
  const calls = [];
  const pub = local.products.filter(p => p.published).map(p => ({ ...p, effPrice: p.salePrice || p.price, inStock: true }));
  pub[0] = { ...pub[0], id: 'p1978b56', cover: SUPA, posters: [SUPA] };
  const byPage = n => ({ items: pub.slice((n - 1) * 10, n * 10), total: pub.length, page: n, pages: Math.ceil(pub.length / 10) });
  const routes = {
    '/api/settings': { ...local.settings, admin: undefined, sessionSecret: undefined },
    '/api/categories': local.categories.map(c => ({ ...c, secretField: 'x' })),
    '/api/homepage': { hero: { title: 'H' }, perksTitle: 'P', showSections: { a: true },
      featured: [pub[0]], newArrivals: [pub[1]], bestsellers: [], collections: [local.categories[0]] },
    '/api/content/faq': { title: 'FAQ', body: 'b', updatedAt: 1 }
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    const u = new URL(url);
    let body = routes[u.pathname];
    if (u.pathname === '/api/products') body = byPage(Number(u.searchParams.get('page')));
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  return { fetchImpl, calls, pub };
}

test('site source: GET only, pages through products, builds a valid snapshot', async () => {
  const { fetchImpl, calls, pub } = fakeSiteFetch();
  const site = await ex.fetchSiteCatalog('https://example.test', { fetchImpl });
  assert.ok(calls.every(c => c.method === 'GET'));
  assert.ok(!calls.some(c => /\/view/.test(c.url)), 'never calls the view counter');
  assert.ok(calls.filter(c => c.url.includes('/api/products')).length >= 2, 'paginated');
  const snap = ex.buildSnapshotFromSite(site, { baseUrl: 'https://example.test' });
  assert.equal(snap.products.length, pub.length);
  assert.equal(snap.products[0].cover, SUPA);
  assert.ok(!('effPrice' in snap.products[0]) && !('inStock' in snap.products[0]), 'derived fields dropped');
  assert.ok(!('secretField' in snap.categories[0]), 'only whitelisted category fields');
  assert.deepEqual(snap.homepage.featuredIds, ['p1978b56']);
  assert.deepEqual(snap.homepage.collectionCategoryIds, [local.categories[0].id]);
  assert.deepEqual(Object.keys(snap.content), ['faq']);
  assert.ok(snap.meta.productSeq >= 198, 'productSeq beyond p197xxxx');
  assert.deepEqual(ex.validateSnapshot(snap).errors, []);
});

test('site getter refuses anything but public catalog endpoints', async () => {
  const get = ex.makeSiteGetter('https://example.test', async () => { throw new Error('should not fetch'); });
  for (const p of ['/api/products/x/view', '/api/admin/products', '/api/orders/track', '/api/cart/track']) {
    await assert.rejects(get(p), /Refusing/);
  }
});

test('maxProductSeq understands server.js id format', () => {
  assert.equal(ex.maxProductSeq([{ id: 'p1978b56' }, { id: 'p01' }, { id: 'p180bd1c' }, { id: 'weird' }]), 197);
});

test('parseArgs validates source and url', () => {
  assert.equal(ex.parseArgs([]).source, 'site');
  assert.throws(() => ex.parseArgs(['--source', 'x']), /source/);
  assert.throws(() => ex.parseArgs(['--url', 'http://evil.example']), /https/);
  assert.equal(ex.parseArgs(['--url', 'https://a.example/path']).url, 'https://a.example');
});
