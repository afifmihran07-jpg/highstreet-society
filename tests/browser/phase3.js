'use strict';
/*
 * Phase 3 browser checks: admin promotions / homepage copy / category editing /
 * bulk actions, and the storefront results (sale prices, promo banner, editable
 * homepage, shop URL state, mobile sticky buy bar, free-delivery progress).
 * Runs LAST in tests/browser/run.js: it changes data on the throwaway server.
 */
const path = require('path');

const money = n => '৳' + Number(n || 0).toLocaleString('en-IN');

async function adminLogin(page, base) {
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  // the context may already hold an admin cookie (API login shares the cookie jar)
  await page.waitForSelector('#u, #pane', { timeout: 15000 });
  if (await page.$('#u')) { await page.fill('#u', 'hssadmin'); await page.fill('#p', 'admin123'); await page.click('#lbtn'); }
  await page.waitForSelector('#pane');
}
async function tab(page, t, sel) {
  await page.evaluate(x => window.GOTAB(x), t);
  await page.waitForSelector(sel, { timeout: 10000 });
}
async function setField(page, sel, value) {
  await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}
const apiAs = async (ctx, base) => {
  const login = await ctx.request.post(base + '/api/admin/login', { data: { username: 'hssadmin', password: 'admin123' } });
  const H = { Authorization: 'Bearer ' + (await login.json()).token };
  return {
    get: async p => (await ctx.request.get(base + p, { headers: H })).json(),
    put: async (p, data) => (await ctx.request.put(base + p, { headers: H, data })).json()
  };
};

module.exports = async function phase3(T) {
  const { browser, base, snap, check, heading, ART } = T;
  const errors = [];
  const published = snap.products.filter(p => p.published);
  const target = published[0];
  const own = target.salePrice && target.salePrice < target.price ? target.salePrice : target.price;
  // deep enough to beat the set's own sale price (live sets: ৳520 regular, ৳420 sale)
  const PCT = 30, expected = Math.max(1, Math.round(target.price * (1 - PCT / 100)));

  /* ---------- admin: promotions → storefront prices + banner ---------- */
  heading('Phase 3 — promotions (admin → storefront)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  T.watch(page, errors);
  page.on('dialog', d => d.accept());
  const api = await apiAs(ctx, base);
  await adminLogin(page, base);
  await tab(page, 'promos', '#pr_add');
  await page.click('#pr_add');
  await setField(page, '[data-k="name"][data-i="0"]', 'Test Sale');
  await setField(page, '[data-k="value"][data-i="0"]', String(PCT));
  await setField(page, '[data-k="banner"][data-i="0"]', 'TEST SALE • 30% OFF ALL SETS');
  await page.click('#pr_save');
  await page.waitForFunction(() => /RUNNING/.test(document.getElementById('pane').innerText), null, { timeout: 8000 }).catch(() => {});
  check('admin: promotion saved and shown as RUNNING', /RUNNING/.test(await page.innerText('#pane')));

  const shop = await ctx.newPage(); T.watch(shop, errors);
  await shop.goto(base + '/shop', { waitUntil: 'networkidle' });
  const card = await shop.$$eval('#grid .card', (cs, name) => {
    const c = cs.find(x => x.querySelector('h3') && x.querySelector('h3').textContent.trim() === name);
    return c ? { price: c.querySelector('.price').textContent, struck: !!c.querySelector('.price s'), tag: (c.querySelector('.ptag') || {}).textContent || '' } : null;
  }, target.name);
  check(`card shows sale ${money(expected)} with ${money(target.price)} struck through`,
    card && card.struck && card.price.includes(money(expected)) && card.price.includes(money(target.price)), JSON.stringify(card));
  check('card shows the -30% tag', card && /-30%/.test(card.tag), card && card.tag);
  check('test precondition: promotion beats the set\'s own price', expected < own, expected + ' vs ' + own);
  const ann = await shop.$eval('#announce', a => ({ t: a.textContent, promo: a.classList.contains('promo') }));
  check('announcement bar shows the promotion banner', ann.promo && ann.t.includes('TEST SALE'), JSON.stringify(ann));
  await shop.goto(base + '/product/' + target.slug, { waitUntil: 'networkidle' });
  check('product page shows promo price and promo label',
    (await shop.innerText('.pricerow')).includes(money(expected)) && /Test Sale/.test(await shop.innerText('.promoline')));
  await api.put('/api/admin/promotions', { promotions: [] });

  /* ---------- admin: homepage copy ---------- */
  heading('Phase 3 — editable homepage copy');
  await tab(page, 'home', '#h_l1t');
  await page.evaluate(() => window.HRECO());
  await page.evaluate(() => window.HSAVE());
  await page.waitForTimeout(600);
  const home = await ctx.newPage(); T.watch(home, errors);
  await home.goto(base + '/', { waitUntil: 'networkidle' });
  const h1 = await home.innerText('.hero2 h1');
  const body = await home.innerText('#content');
  check('hero headline comes from the admin (poster copy)', /SIX POSTERS/.test(h1), h1.replace(/\n/g, ' '));
  // (the footer shows the store's own brand tagline from Admin → Store settings — data, not code)
  check('no clothing wording in the homepage content ("wear", "comfort", "outfit")', !/\bWEAR\b|COMFORT|OUTFIT|STREETWEAR/i.test(body),
    (body.match(/.{0,30}(\bWEAR\b|COMFORT|OUTFIT|STREETWEAR).{0,30}/i) || [''])[0]);
  check('marquee, perks and tagline come from the admin',
    body.includes('6 POSTERS PER SET') && body.includes('Curated themed drops') && body.includes('A4 • 3MM BOARD'));
  await home.screenshot({ path: path.join(ART, 'phase3-home.png') });

  /* ---------- admin: category description ---------- */
  heading('Phase 3 — category editing + shop URL state');
  const cat = snap.categories.find(c => c.visible !== false && published.some(p => (p.categoryIds || []).includes(c.id)));
  await tab(page, 'cats', '.atable');
  await page.evaluate(id => window.CED(id), cat.id);
  await page.fill('#ce_desc', 'Test description for ' + cat.name);
  await page.click('#ce_save');
  await page.waitForTimeout(600);
  await shop.goto(base + '/shop?cat=' + encodeURIComponent(cat.id), { waitUntil: 'networkidle' });
  check('category page shows its name and admin description',
    (await shop.innerText('.shophead h1')).includes(cat.name.toUpperCase()) && (await shop.innerText('.catdesc')).includes('Test description'));
  await shop.goto(base + '/shop', { waitUntil: 'networkidle' });
  await shop.click(`#catchips button[data-c="${cat.id}"]`);
  await shop.waitForTimeout(400);
  await shop.selectOption('#sort', 'price-asc');
  await shop.waitForTimeout(500);
  check('filters are kept in the URL', /cat=/.test(shop.url()) && /sort=price-asc/.test(shop.url()), shop.url());
  await shop.reload({ waitUntil: 'networkidle' });
  const kept = await shop.evaluate(() => ({ sort: document.getElementById('sort').value, on: (document.querySelector('#catchips .on') || {}).dataset }));
  check('reload / back restores the same category and sort', kept.sort === 'price-asc' && kept.on && kept.on.c === cat.id, JSON.stringify(kept));

  /* ---------- admin: bulk actions ---------- */
  heading('Phase 3 — bulk product actions');
  await tab(page, 'products', '.psel');
  const ids = await page.$$eval('.psel', cs => cs.slice(0, 2).map(c => c.value));
  for (const id of ids) await page.check(`.psel[value="${id}"]`);
  check('bulk bar appears with the selection count', (await page.innerText('#bulkn')).startsWith('2 selected'));
  await page.selectOption('#bulka', 'flagOn');
  await page.waitForSelector('#bulkval');
  await page.selectOption('#bulkval', 'bestseller');
  await page.click('#bulkgo');
  await page.waitForTimeout(800);
  const after = (await api.get('/api/admin/products')).products.filter(p => ids.includes(p.id));
  check('bulk "turn ON Bestseller" updated both selected sets', after.length === 2 && after.every(p => p.bestseller));
  await page.screenshot({ path: path.join(ART, 'phase3-admin-bulk.png') });
  await ctx.close();

  /* ---------- mobile: sticky buy bar + free delivery progress ---------- */
  heading('Phase 3 — mobile buying');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await mctx.newPage(); T.watch(m, errors);
  const mapi = await apiAs(mctx, base);
  await m.goto(base + '/product/' + target.slug, { waitUntil: 'networkidle' });
  check('sticky buy bar hidden while the main buttons are visible', !(await m.$eval('.stickybuy', b => b.classList.contains('on'))));
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await m.waitForTimeout(500);
  const bar = await m.evaluate(() => { const b = document.querySelector('.stickybuy').getBoundingClientRect();
    const t = document.querySelector('.tabbar').getBoundingClientRect();
    return { on: document.querySelector('.stickybuy').classList.contains('on'), bottom: b.bottom, tabTop: t.top, h: b.height }; });
  check('sticky buy bar appears after scrolling, above the tab bar', bar.on && bar.h > 30 && bar.bottom <= bar.tabTop + 1, JSON.stringify(bar));
  await m.click('.stickybuy .btn');
  check('sticky "Add to cart" adds the set', await m.evaluate(() => HSS.cartCount()) === 1);
  await m.screenshot({ path: path.join(ART, 'phase3-mobile-sticky.png') });
  const prevFree = snap.settings.delivery.freeAbove || 0;
  await mapi.put('/api/admin/settings', { delivery: { freeAbove: target.price * 3 } });
  await m.evaluate(() => sessionStorage.clear());
  await m.goto(base + '/cart', { waitUntil: 'networkidle' });
  const fs = await m.innerText('.freeship').catch(() => '');
  check('cart shows how much more for free delivery', fs.includes(money(target.price * 3 - own)) && /free delivery/i.test(fs), fs);
  await mapi.put('/api/admin/settings', { delivery: { freeAbove: prevFree } });
  await mctx.close();

  check('no JS errors, console errors or failed requests (phase 3)', !errors.length, errors.slice(0, 4).join(' || '));
};
