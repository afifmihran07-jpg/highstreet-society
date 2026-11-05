#!/usr/bin/env node
'use strict';
/*
 * HSS browser test suite (real browser, desktop + mobile).
 *
 *   npm run test:browser
 *
 * - Starts its own local server on a TEMPORARY copy of data/db.live.json
 *   (so it never changes data/db.local.json, data/db.json or production),
 *   with uploads forced to local storage. Set BASE_URL to test a server you
 *   already started instead (e.g. BASE_URL=http://localhost:3000).
 * - Uses the installed Microsoft Edge (or Chrome) through playwright-core,
 *   so no browser download is needed. Override with HSS_BROWSER=chrome|msedge.
 * - Expected products/categories/prices are read from the snapshot, so the
 *   suite verifies that the local site shows exactly what production has.
 * - Product images are Supabase Storage public URLs; they are fetched
 *   read-only (HEAD) to confirm every one exists.
 * - Screenshots land in tests/browser/artifacts/ (gitignored).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { buildLocalCopy, devEnv } = require('../../scripts/dev');
const flows = require('./flows');

const ROOT = path.join(__dirname, '..', '..');
const SNAPSHOT = path.join(ROOT, 'data', 'db.live.json');
const ART = path.join(__dirname, 'artifacts');
const PORT = 3930;

const results = [];
let section = '';
function check(label, ok, detail = '') {
  results.push({ label: `${section} › ${label}`, ok: !!ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '  — ' + detail : ''}`);
}
function heading(t) { section = t; console.log('\n' + t); }
const money = n => '৳' + Number(n || 0).toLocaleString('en-IN');
const effPrice = p => (p.salePrice && p.salePrice < p.price) ? p.salePrice : p.price;

/* ---------------- server ---------------- */
async function startServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL.replace(/\/$/, ''), stop: () => {}, log: () => '' };
  const tmp = path.join(os.tmpdir(), `hss-browser-${process.pid}.json`);
  const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  fs.writeFileSync(tmp, JSON.stringify(buildLocalCopy(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')), demo)));
  const env = { ...devEnv(), HSS_DATA_FILE: tmp, PORT: String(PORT) };
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env });
  let out = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', d => { out += d; if (/HSS running/.test(out)) resolve(); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', c => reject(new Error('server exited ' + c + '\n' + out)));
    setTimeout(() => reject(new Error('server start timeout\n' + out)), 20000);
  });
  console.log('[browser] ' + out.trim().split('\n').filter(l => /Environment|Persistence|running/.test(l)).join(' | '));
  return { base: `http://127.0.0.1:${PORT}`, stop: () => { child.kill(); fs.rmSync(tmp, { force: true }); }, log: () => out };
}

async function launchBrowser() {
  const channels = process.env.HSS_BROWSER ? [process.env.HSS_BROWSER] : ['msedge', 'chrome'];
  for (const channel of channels) {
    try { return await chromium.launch({ channel, headless: true }); } catch (_) { /* try next */ }
  }
  throw new Error('No installed Edge/Chrome found for playwright-core (set HSS_BROWSER).');
}

/* ---------------- page helpers ---------------- */
function watch(page, errors) {
  page.on('pageerror', e => errors.push(`JS error on ${page.url()}: ${String(e).slice(0, 200)}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|Unauthorized/.test(t)) return;   // anonymous /api/auth/me probe is expected
    errors.push(`console.error on ${page.url()}: ${t.slice(0, 200)}`);
  });
  page.on('response', r => {
    const u = r.url();
    // 401s from session probes are expected while logged out.
    const expected401 = r.status() === 401 && /\/api\/(auth\/me|designs\/mine|orders\/mine|admin\/me|admin\/refresh)$/.test(u);
    if (r.status() >= 400 && !expected401) {
      errors.push(`HTTP ${r.status()} ${u}`);
    }
  });
}

/** Scroll through the page so lazy images load, then report images that failed. */
async function brokenImages(page, selector) {
  // Force lazy images to load now, then wait until every one has settled.
  await page.$$eval(selector, imgs => imgs.forEach(i => { i.loading = 'eager'; }));
  await page.waitForFunction(sel => [...document.querySelectorAll(sel)].every(i => i.complete), selector, { timeout: 45000 }).catch(() => {});
  return page.$$eval(selector, imgs => imgs
    .filter(i => !i.complete || i.naturalWidth === 0 || /\/images\/logo\.png$/.test(i.currentSrc || i.src))
    .map(i => i.getAttribute('src')));
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/* ---------------- suites ---------------- */
async function resizedImages(base, snap) {
  heading('Resized images (/img)');
  const u = snap.products[0].cover;
  const t0 = Date.now();
  const r = await fetch(base + '/img?w=600&u=' + encodeURIComponent(u), { headers: { Accept: 'image/webp,*/*' }, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  const orig = await fetch(u, { method: 'HEAD' });
  const origKB = Math.round(Number(orig.headers.get('content-length')) / 1024);
  check(`600 w WebP served (${Math.round(buf.length / 1024)} KB vs ${origKB} KB original, ${Date.now() - t0} ms)`,
    r.status === 200 && r.headers.get('content-type') === 'image/webp' && buf.length < 250 * 1024 && buf.length < origKB * 1024 / 3);
  check('long browser cache on resized images', /max-age=2592000/.test(r.headers.get('cache-control') || ''));
  const t1 = Date.now();
  await fetch(base + '/img?w=600&u=' + encodeURIComponent(u), { headers: { Accept: 'image/webp' } }).then(x => x.arrayBuffer());
  check(`second request served from disk cache (${Date.now() - t1} ms)`, Date.now() - t1 < 500);
  for (const bad of ['https://evil.example/x.png', 'http://127.0.0.1:3930/api/admin/orders', u.replace('product-images', 'other-bucket')]) {
    const b = await fetch(base + '/img?w=600&u=' + encodeURIComponent(bad), { redirect: 'manual' });
    check(`refuses non-shop image source (${bad.slice(0, 40)}…)`, b.status === 400);
  }
  const bw = await fetch(base + '/img?w=7&u=' + encodeURIComponent(u), { redirect: 'manual' });
  check('refuses arbitrary widths', bw.status === 400);
}

async function imageIntegrity(snap) {
  heading('Image URLs (read-only HEAD requests)');
  const urls = [...new Set(snap.products.flatMap(p => [p.cover, ...(p.posters || [])]).filter(Boolean))];
  const remote = urls.filter(u => /^https?:/.test(u));
  check(`all ${urls.length} product image URLs are Supabase Storage URLs`,
    urls.every(u => /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\//.test(u)),
    urls.filter(u => !/supabase\.co/.test(u)).slice(0, 3).join(', '));
  const bad = [];
  for (let i = 0; i < remote.length; i += 8) {
    await Promise.all(remote.slice(i, i + 8).map(async u => {
      try {
        const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
        if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) bad.push(`${r.status} ${u}`);
      } catch (e) { bad.push(`ERR ${u}`); }
    }));
  }
  check(`all ${remote.length} remote images respond 200 image/*`, !bad.length, bad.slice(0, 3).join(' | '));
}

async function storefront(browser, base, snap, vp) {
  const mobile = vp.width < 700;
  const wide = vp.width >= 1000;
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  const tag = mobile ? 'mobile' : wide ? 'desktop' : 'tablet';
  const published = snap.products.filter(p => p.published);
  const visibleCats = snap.categories.filter(c => c.visible !== false);

  heading(`Homepage [${tag} ${vp.width}px]`);
  const res = await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  check('responds 200', res.status() === 200, String(res.status()));
  await page.waitForSelector('.card', { timeout: 20000 });
  const title = await page.title();
  check('title is clean (no garbled characters)', !/â€|Ã|à§/.test(title) && /Highstreet Society/.test(title), title);
  const text = await page.innerText('body');
  check('no garbled characters anywhere in page text', !/â€|Ã‚|à§/.test(text));
  check('hero headline from live homepage config', text.includes(snap.homepage.hero.line1 || 'WEAR THE'));
  if (snap.settings.announcement) check('announcement bar shows live text', text.includes(snap.settings.announcement.split('•')[0].trim()));
  const homeCats = await page.$$eval('a.ccard', as => as.map(a => a.getAttribute('href')));
  const expectedColl = snap.homepage.collectionCategoryIds.filter(id => visibleCats.some(c => c.id === id));
  check(`collections show ${expectedColl.length} live categories`, expectedColl.every(id => homeCats.includes('/shop?cat=' + id)),
    homeCats.join(','));
  const cardNames = await page.$$eval('.card h3', hs => hs.map(h => h.textContent.trim()));
  check('every product card is a live product', cardNames.length > 0 && cardNames.every(n => published.some(p => p.name === n)),
    cardNames.filter(n => !published.some(p => p.name === n)).join(', '));
  const brokenHome = await brokenImages(page, '.card img');
  check('all homepage product images load', !brokenHome.length, brokenHome.slice(0, 3).join(', '));
  check('no horizontal overflow', (await overflow(page)) <= 1);
  await page.screenshot({ path: path.join(ART, `home-${tag}.png`), fullPage: false });

  heading(`Shop [${tag}]`);
  await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#grid .card').length > 0, null, { timeout: 20000 });
  const shown = Math.min(24, published.length);
  check(`shows ${shown} of ${published.length} published sets`, (await page.$$('#grid .card')).length === shown);
  check('count line', (await page.innerText('#count')).includes(`${published.length} set`), await page.innerText('#count'));
  const chips = await page.$$eval('#catchips .chip', bs => bs.map(b => b.textContent.trim()));
  check(`category chips = All + ${visibleCats.length} live categories`,
    chips.length === visibleCats.length + 1 && visibleCats.every(c => chips.includes(c.name)), chips.join(' | '));
  const prices = await page.$$eval('#grid .card .price', ps => ps.map(p => p.textContent));
  const expectedPrices = new Set(published.map(p => money(effPrice(p))));
  check(`prices match live data (${[...expectedPrices].join(', ')})`, prices.every(t => [...expectedPrices].some(m => t.includes(m))),
    prices.slice(0, 3).join(' | '));
  check('cards describe A4 6-poster sets', (await page.$$eval('#grid .card .pb .meta', ms => ms.map(m => m.textContent)))
    .every(t => /6 posters • A4/.test(t)));
  const brokenShop = await brokenImages(page, '#grid .card img');
  check('all shop images load', !brokenShop.length, brokenShop.slice(0, 3).join(', '));
  check('no horizontal overflow', (await overflow(page)) <= 1);
  await page.screenshot({ path: path.join(ART, `shop-${tag}.png`) });

  heading(`Categories [${tag}]`);
  for (const c of visibleCats) {
    const expected = published.filter(p => (p.categoryIds || []).includes(c.id)).map(p => p.name).sort();
    await page.goto(base + '/shop?cat=' + encodeURIComponent(c.id), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#grid .card, #grid .empty h3:not(:empty)') &&
      !/Loading/.test(document.querySelector('#grid').textContent), null, { timeout: 20000 });
    const names = (await page.$$eval('#grid .card h3', hs => hs.map(h => h.textContent.trim()))).sort();
    check(`${c.name}: ${expected.length} set(s)`, JSON.stringify(names) === JSON.stringify(expected.slice(0, 24)),
      `got [${names.join(', ')}]`);
  }
  // interactive chip click
  await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grid .card');
  const firstCat = visibleCats[0];
  await page.click(`#catchips .chip[data-c="${firstCat.id}"]`);
  await page.waitForFunction(id => document.querySelector(`#catchips .chip.on[data-c="${id}"]`), firstCat.id);
  await page.waitForTimeout(500);
  const afterClick = await page.$$eval('#grid .card h3', hs => hs.length);
  check(`clicking "${firstCat.name}" chip filters the grid`,
    afterClick === published.filter(p => p.categoryIds.includes(firstCat.id)).length, String(afterClick));

  heading(`Product pages [${tag}]`);
  const toVisit = wide ? published : published.slice(0, 3);
  for (const p of toVisit) {
    const r = await page.goto(base + '/product/' + p.slug, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pinfo h1', { timeout: 20000 });
    const h1 = (await page.innerText('.pinfo h1')).trim();
    const now = (await page.innerText('.pricerow .now')).trim();
    // thumbnails are served resized through /img?w=…&u=<original>; compare the originals
    const thumbs = (await page.$$eval('#gthumbs img', is => is.map(i => i.getAttribute('src'))))
      .map(src => src.startsWith('/img?') ? new URLSearchParams(src.slice(5)).get('u') : src);
    const expectedImgs = [p.cover, ...(p.posters || [])].filter(Boolean);
    const spec = await page.innerText('.specbox').catch(() => '');
    await page.waitForFunction(() => { const i = document.getElementById('gimg'); return i && i.complete; }, null, { timeout: 30000 }).catch(() => {});
    const mainOk = await page.$eval('#gimg', i => i.naturalWidth > 0 && !/logo\.png$/.test(i.currentSrc || i.src));
    const ok = r.status() === 200 && h1 === p.name && now === money(effPrice(p)) &&
      JSON.stringify(thumbs) === JSON.stringify(expectedImgs) && thumbs.length === 7 && mainOk &&
      /6/.test(spec) && /A4/.test(spec);
    check(`${p.slug}: name, ${money(effPrice(p))}, cover + 6 posters, specs, main image loads`, ok,
      `status=${r.status()} h1="${h1}" price="${now}" thumbs=${thumbs.length} mainImg=${mainOk} spec="${spec.replace(/\s+/g, ' ')}"`);
  }
  // gallery navigation on one product
  const gp = published[0];
  await page.goto(base + '/product/' + gp.slug, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gcount');
  await page.click('.gnav.r');
  check('gallery next button advances to poster 2', /^2 \/ 7/.test(await page.innerText('#gcount')), await page.innerText('#gcount'));
  const brokenThumbs = await brokenImages(page, '#gthumbs img');
  check('all 7 gallery thumbnails load', !brokenThumbs.length, brokenThumbs.join(', '));
  check('no horizontal overflow on product page', (await overflow(page)) <= 1);
  await page.screenshot({ path: path.join(ART, `product-${tag}.png`) });

  heading(`Navigation & cart [${tag}]`);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card');
  if (await page.isVisible('nav.main a[href="/shop"]')) await page.click('nav.main a[href="/shop"]');
  else await page.click('nav.tabbar a[href="/shop"]');
  await page.waitForURL('**/shop');
  check('header/tab bar → Shop', page.url().endsWith('/shop'));
  await page.waitForSelector('#grid .card h3');
  const firstName = (await page.innerText('#grid .card h3')).trim();
  await page.click('#grid .card a.ph');
  await page.waitForURL('**/product/**');
  await page.waitForSelector('.pinfo h1');
  check('product card → product page', (await page.innerText('.pinfo h1')).trim() === firstName, firstName);
  await page.click('.crumbs a[href="/shop"]');
  await page.waitForURL('**/shop');
  check('breadcrumb → Shop', page.url().endsWith('/shop'));
  await page.waitForSelector('#grid .card .addbtn');
  const cardName = (await page.innerText('#grid .card h3')).trim();
  const cardProduct = published.find(p => p.name === cardName);
  await page.click('#grid .card .addbtn');
  await page.goto(base + '/cart', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(n => document.body.innerText.includes(n), cardName, { timeout: 15000 }).catch(() => {});
  const cartText = await page.innerText('body');
  check('add to cart → item in cart with live price',
    cartText.includes(cardName) && cartText.includes(money(effPrice(cardProduct))), cardName);
  for (const [href, expectText] of [['/about', 'Marvelverse'], ['/about', '৳420'], ['/contact', snap.settings.contact.mobile || 'Contact'],
    ['/policy/faq', (snap.content.faq || {}).title || 'FAQ'], ['/policy/shipping', (snap.content.shipping || {}).title || 'Shipping'],
    ['/track', 'Track']]) {
    const r = await page.goto(base + href, { waitUntil: 'domcontentloaded' });
    const has = t => document.body.innerText.toLowerCase().includes(t.toLowerCase());   // headings are CSS/JS-uppercased
    await page.waitForFunction(has, expectText, { timeout: 10000 }).catch(() => {});
    check(`${href} loads and shows "${expectText}"`, r.status() === 200 && await page.evaluate(has, expectText));
  }
  const nf = await page.goto(base + '/no-such-page', { waitUntil: 'domcontentloaded' });
  check('unknown URL → 404 page', nf.status() === 404);
  for (let i = errors.length - 1; i >= 0; i--) if (/no-such-page/.test(errors[i])) errors.splice(i, 1); // expected 404

  heading(`Console & network errors [${tag}]`);
  check('no JS errors, console errors or failed requests', !errors.length, errors.slice(0, 5).join(' || '));
  await ctx.close();
}

async function admin(browser, base, snap) {
  heading('Admin (local demo login)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  await page.fill('#u', 'hssadmin');
  await page.fill('#p', 'admin123');
  await page.click('#lbtn');
  await page.waitForSelector('#pane', { timeout: 15000 });
  check('local admin login works', true);
  await page.evaluate(() => window.GOTAB('products'));
  await page.waitForFunction(() => document.querySelectorAll('#pane table tbody tr, #pane .acard').length > 0, null, { timeout: 15000 }).catch(() => {});
  const pane = await page.innerText('#pane');
  const missing = snap.products.filter(p => !pane.includes(p.name)).map(p => p.name);
  check(`products tab lists all ${snap.products.length} live products`, !missing.length, missing.join(', '));
  await page.evaluate(() => window.GOTAB('pnew'));
  await page.waitForSelector('#typepick');
  const types = await page.$$eval('#typepick .tp', bs => bs.map(b => b.dataset.t));
  check('new product: poster set is the only type offered', JSON.stringify(types) === '["poster"]', types.join(','));
  check('new product: default price ৳420', (await page.inputValue('#e_price')) === '420', await page.inputValue('#e_price'));
  check('no admin JS/console errors', !errors.length, errors.slice(0, 3).join(' || '));
  await page.screenshot({ path: path.join(ART, 'admin-products.png') });
  await ctx.close();
}

/* ---------------- main ---------------- */
(async () => {
  if (!fs.existsSync(SNAPSHOT)) {
    console.error('data/db.live.json missing — run `npm run export:catalog` first.');
    process.exit(1);
  }
  fs.mkdirSync(ART, { recursive: true });
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  console.log(`[browser] Expecting ${snap.products.length} products / ${snap.categories.length} categories ` +
    `from snapshot exported ${snap._export && snap._export.exportedAt}`);
  const server = await startServer();
  let browser;
  try {
    await imageIntegrity(snap);
    await resizedImages(server.base, snap);
    browser = await launchBrowser();
    console.log('[browser] Using ' + browser.version());
    await storefront(browser, server.base, snap, { width: 1280, height: 900 });
    await storefront(browser, server.base, snap, { width: 768, height: 1024 });
    await storefront(browser, server.base, snap, { width: 390, height: 844 });
    await admin(browser, server.base, snap);
    const T = { browser, base: server.base, snap, check, heading, ART, watch, errors: [] };
    await flows.firstPaint(T);
    await flows.freshLoads(T);
    await flows.noFlicker(T);
    await flows.search(T);
    await flows.checkoutFlows(T);
    await flows.customerFlows(T);
    await flows.adminModules(T);
    await flows.phase3(T);   // last: it changes prices/homepage on the throwaway server
    heading('Server log');
    const badLines = server.log().split('\n').filter(l =>
      /\[uncaught\]|\[unhandled-rejection\]|TypeError|ReferenceError|\[img\] falling back|\[supabase upload\]/.test(l));
    check('no uncaught exceptions, crashes or image fallbacks on the server', !badLines.length, badLines.slice(0, 3).join(' | '));
    heading('Console & network errors during flows');
    check('no JS errors, console errors or failed requests', !T.errors.length, T.errors.slice(0, 5).join(' || '));
  } catch (e) {
    check('suite ran to completion', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
  } finally {
    if (browser) await browser.close();
    server.stop();
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  failed.forEach(f => console.log('  FAIL  ' + f.label + (f.detail ? '  — ' + f.detail : '')));
  process.exit(failed.length ? 1 : 0);
})();
