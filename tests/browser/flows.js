'use strict';
/*
 * End-to-end flows for tests/browser/run.js. Every write (orders, accounts,
 * designs, reviews) goes to the throwaway local server started by run.js —
 * never to production.
 */
const path = require('path');

const MOJIBAKE = /â€|Ã[\u0080-¿]|Ã‚|à§|â—|ï¿½|�/;
const PAGES = ['/', '/shop', '/product/{slug}', '/cart', '/checkout', '/about', '/contact', '/track', '/account',
  '/wishlist', '/custom-design', '/policy/faq', '/policy/shipping', '/success', '/admin', '/no-such-page'];

async function adminApi(ctx, base) {
  const login = await ctx.request.post(base + '/api/admin/login', { data: { username: 'hssadmin', password: 'admin123' } });
  const { token } = await login.json();
  const H = { Authorization: 'Bearer ' + token };
  return {
    get: async p => (await ctx.request.get(base + p, { headers: H })).json(),
    post: async (p, data) => (await ctx.request.post(base + p, { headers: H, data })).json(),
    put: async (p, data) => (await ctx.request.put(base + p, { headers: H, data })).json()
  };
}

/* 1. What visitors see before any JavaScript runs (= the very first paint). */
async function firstPaint(T) {
  const { browser, base, snap, check, heading, ART } = T;
  for (const [vp, tag] of [[{ width: 1280, height: 800 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
    heading(`First paint, JavaScript disabled [${tag}]`);
    const ctx = await browser.newContext({ viewport: vp, javaScriptEnabled: false });
    const page = await ctx.newPage();
    for (const p of PAGES.map(x => x.replace('{slug}', snap.products[0].slug))) {
      await page.goto(base + p, { waitUntil: 'load' });
      const title = await page.title();
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      const metas = await page.$$eval('meta[content]', ms => ms.map(m => m.content).join(' '));
      const bad = (title + ' ' + text + ' ' + metas).match(new RegExp(MOJIBAKE.source, 'g'));
      const glyph = /◌/.test(text);
      check(`${p}: no garbled characters or font-dependent glyphs before JS`, !bad && !glyph,
        (bad ? 'garbled: ' + [...new Set(bad)].join(' ') : '') + (glyph ? ' dotted-circle glyph' : ''));
    }
    await page.goto(base + '/', { waitUntil: 'load' });
    check('homepage loader is the CSS spinner', await page.$('#content .spin') !== null);
    check('homepage announcement starts empty (no placeholder text swap)', (await page.innerText('#announce')).trim() === '');
    await page.screenshot({ path: path.join(ART, `firstpaint-${tag}.png`) });
    await ctx.close();
  }
}

/* 1b. Repeated fresh loads with JavaScript ON: watch every text node and title
   change from the very first byte until the page settles. */
async function freshLoads(T, runs = 5) {
  const { browser, base, check, heading } = T;
  const WATCH = `(() => {
    const BAD = ${MOJIBAKE.toString()};
    const GLYPH = /\\u25CC/;
    window.__bad = [];
    const scan = (txt, where) => { if (txt && (BAD.test(txt) || GLYPH.test(txt))) window.__bad.push(where + ': ' + txt.trim().slice(0, 60)); };
    new MutationObserver(ms => { for (const m of ms) {
      if (m.type === 'characterData') scan(m.target.data, 'text');
      for (const n of m.addedNodes || []) scan(n.nodeType === 3 ? n.data : (n.textContent || ''), 'node');
    } }).observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener('DOMContentLoaded', () => { scan(document.title, 'title'); scan(document.body.innerText, 'initial body'); });
  })();`;
  for (const [vp, tag] of [[{ width: 1280, height: 800 }, 'desktop'], [{ width: 390, height: 844 }, 'mobile']]) {
    heading(`Repeated fresh homepage loads, JavaScript on [${tag}]`);
    const found = [];
    for (let i = 0; i < runs; i++) {
      const ctx = await browser.newContext({ viewport: vp, isMobile: tag === 'mobile' });   // empty cache + storage each time
      const page = await ctx.newPage();
      await page.addInitScript(WATCH);
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      const bad = await page.evaluate(() => window.__bad.concat(
        /â€|Ã|à§|◌/.test(document.title) ? ['final title: ' + document.title] : []));
      found.push(...bad);
      // Guard against false passes: the page must really be the HSS homepage
      // (e.g. not a hosting "service waking up" placeholder).
      const real = await page.$('#hdr .logo') && await page.$('.card');
      if (!real) found.push(`load ${i + 1}: not the HSS homepage ("${(await page.title()).slice(0, 40)}")`);
      await ctx.close();
    }
    check(`${runs} fresh loads: no garbled text or glyphs at any moment during rendering`, !found.length, found.slice(0, 3).join(' | '));
  }
}

/* 2. Layout paints immediately; announcement bar does not shift. */
async function noFlicker(T) {
  const { browser, base, snap, check, heading } = T;
  heading('First-load flicker (settings API delayed 2.5 s)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**/api/settings', async route => { await new Promise(r => setTimeout(r, 2500)); route.continue(); });
  // first visit (no cache): bar height must not change when the text arrives
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  const h0 = await page.$eval('#announce', e => e.getBoundingClientRect().height);
  check('header painted immediately on first visit', await page.waitForSelector('#hdr .logo', { timeout: 800 }).then(() => true, () => false));
  await page.waitForFunction(() => document.getElementById('announce').textContent.trim().length > 0, null, { timeout: 15000 });
  const h1 = await page.$eval('#announce', e => e.getBoundingClientRect().height);
  check(`announcement bar height stable (${h0}px → ${h1}px)`, Math.abs(h0 - h1) < 1);
  // second page (cache in sessionStorage): full chrome + live announcement without waiting for the API
  const t0 = Date.now();
  await page.goto(base + '/about', { waitUntil: 'domcontentloaded' });
  const ok = await page.waitForFunction(a => document.querySelector('#hdr .logo') && document.querySelector('#ftr .fgrid') &&
    document.getElementById('announce').textContent === a, snap.settings.announcement, { timeout: 1500 }).then(() => true, () => false);
  check(`cached visit: header, footer and live announcement painted before the settings API answered (${Date.now() - t0} ms)`, ok);
  await ctx.close();
}

/* 3. Search */
async function search(T) {
  const { browser, base, snap, check, heading } = T;
  heading('Shop search');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  T.watch(page, T.errors);
  await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grid .card');
  const term = 'marvel';
  const expected = snap.products.filter(p => p.published && JSON.stringify([p.name, p.slug, p.tags, p.short,
    p.categoryIds.map(id => (snap.categories.find(c => c.id === id) || {}).name)]).toLowerCase().includes(term)).length;
  await page.fill('#q', term);
  await page.waitForFunction(n => document.querySelectorAll('#grid .card').length === n, expected, { timeout: 8000 }).catch(() => {});
  const names = await page.$$eval('#grid .card h3', hs => hs.map(h => h.textContent));
  check(`search "${term}" → ${expected} result(s)`, names.length === expected && names.every(n => /marvel/i.test(n)), names.join(', '));
  await page.fill('#q', 'zzqqxx');
  await page.waitForSelector('#grid .empty', { timeout: 8000 }).catch(() => {});
  check('search with no match shows the empty state', /No sets found/i.test(await page.innerText('#grid')));
  await ctx.close();
}

async function fillAddress(page) {
  await page.fill('#f_name', 'Test Customer');
  await page.fill('#f_mobile', '01712345678');
  await page.selectOption('#f_div', { label: 'Dhaka' });
  await page.waitForSelector('#f_dist:not([disabled])');
  await page.selectOption('#f_dist', { label: 'Dhaka' });
  await page.waitForFunction(() => { const s = document.getElementById('f_area'); return !s.disabled && s.options.length > 1; });
  const val = await page.$eval('#f_area', s => s.options[1].value);
  await page.selectOption('#f_area', val);
  await page.fill('#f_local', 'Dhanmondi');
  await page.fill('#f_addr', 'House 12, Road 5, Test Block');
}

/* 4. Cart → checkout → order → success → tracking → admin → cancel/restock */
async function checkoutFlows(T) {
  const { browser, base, snap, check, heading } = T;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  T.watch(page, T.errors);
  const admin = await adminApi(ctx, base);
  const p = snap.products.find(x => x.published && x.stock > 3);
  const stockBefore = (await (await ctx.request.get(base + '/api/products/' + p.slug)).json()).product.stock;

  for (const method of ['cod', 'bkash']) {
    heading(`Checkout — ${method.toUpperCase()} [mobile]`);
    await page.goto(base + '/product/' + p.slug, { waitUntil: 'domcontentloaded' });
    await page.evaluate(id => { HSS.setCart([]); HSS.addToCart(id); HSS.addToCart(id); }, p.id);
    await page.goto(base + '/cart', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(n => document.body.innerText.includes(n), p.name);
    check('cart shows the product with the live price', (await page.innerText('body')).includes('৳420'));
    await page.goto(base + '/checkout', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#f_name');
    await fillAddress(page);
    await page.waitForFunction(() => /৳/.test(document.getElementById('zonebox').textContent));
    check('delivery charge appears after choosing the thana', /৳\s?70|৳\s?130/.test(await page.innerText('#zonebox')), await page.innerText('#zonebox'));
    if (method === 'bkash') {
      await page.evaluate(() => window.SETPAY('bkash'));
      await page.waitForSelector('#f_trx');
      check('bKash shows the live merchant number', (await page.innerText('#paylist')).includes(snap.settings.payments.bkash.number));
      await page.fill('#f_trx', 'TEST' + Date.now().toString(36).toUpperCase());
    }
    await page.click('#place');
    await page.waitForURL('**/success**', { timeout: 15000 }).catch(() => {});
    const url = new URL(page.url());
    const id = url.searchParams.get('id');
    check('order placed → success page with order ID', /\/success/.test(url.pathname) && /^HSS-\d+$/.test(id || ''), page.url());
    if (!id) continue;
    await page.waitForFunction(i => document.body.innerText.includes(i), id, { timeout: 8000 }).catch(() => {});
    check('success page shows the order ID', (await page.innerText('body')).includes(id));
    const order = (await admin.get('/api/admin/orders')).orders.find(o => o.id === id);
    check('admin sees the order with server-computed total', order && order.items.length === 1 && order.items[0].qty === 2 &&
      order.total === 2 * 420 + order.deliveryCharge, order && JSON.stringify({ items: order.items.length, qty: order.items[0].qty, total: order.total }));
    check(method === 'cod' ? 'COD order is pending / unpaid' : 'bKash order awaits payment verification',
      order && (method === 'cod' ? order.status === 'pending' && order.paymentStatus === 'unpaid'
        : order.status === 'payment-pending' && order.paymentStatus === 'pending-verification'), order && order.status + '/' + order.paymentStatus);
    await page.goto(`${base}/track?id=${id}&mobile=01712345678`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.TRACK && window.TRACK());
    await page.waitForFunction(i => document.getElementById('res').innerText.includes(i), id, { timeout: 8000 }).catch(() => {});
    check('order tracking finds the order', (await page.innerText('#res')).includes(id));
    if (method === 'bkash') {
      const upd = await admin.put('/api/admin/orders/' + id, { status: 'cancelled' });
      check('admin can cancel the order', upd && (upd.ok || upd.order), JSON.stringify(upd).slice(0, 120));
    }
  }
  const stockAfter = (await (await ctx.request.get(base + '/api/products/' + p.slug)).json()).product.stock;
  check(`stock: −2 for the live COD order, +2 restored for the cancelled bKash order (${stockBefore} → ${stockAfter})`, stockAfter === stockBefore - 2);
  await ctx.close();
}

/* 5. Customer account, password reset via admin code, wishlist, custom design */
async function customerFlows(T) {
  const { browser, base, snap, check, heading } = T;
  heading('Customer account & password reset');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  T.watch(page, T.errors);
  const admin = await adminApi(ctx, base);
  const mobile = '0181' + String(Date.now()).slice(-7);
  await page.goto(base + '/account', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#a_mobile');
  await page.evaluate(() => window.MODE());
  await page.fill('#a_name', 'Flow Tester');
  await page.fill('#a_mobile', mobile);
  await page.fill('#a_pw', 'firstpass');
  await page.click('button:has-text("Create account")');
  await page.waitForFunction(() => !document.getElementById('a_mobile'), null, { timeout: 8000 }).catch(() => {});
  check('register → signed in to the account page', !(await page.$('#a_mobile')));

  // forgot password: no token handed out, WhatsApp request link shown
  const forgot = await (await ctx.request.post(base + '/api/auth/forgot', { data: { mobile } })).json();
  check('forgot-password API never returns a reset token', !('resetToken' in forgot) && forgot.ok);
  await page.evaluate(() => { HSS.store.remove('hss_token'); });
  await ctx.clearCookies();
  await page.goto(base + '/account', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#forgotLink');
  await page.click('#forgotLink');
  await page.waitForSelector('#f_code');
  const wa = await page.getAttribute('#f_wa', 'href').catch(() => null);
  check('reset screen offers a WhatsApp code request', !!wa && /^https:\/\/wa\.me\/\d+\?text=/.test(wa), wa);
  const cust = (await admin.get('/api/admin/customers')).customers.find(c => c.mobile === mobile);
  const rc = await admin.post('/api/admin/customers/' + cust.id + '/reset-code', {});
  check('admin can generate a reset code', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(rc.code || ''), rc.code);
  await page.fill('#f_mobile', mobile);
  await page.fill('#f_code', 'AAAA-AAAA');
  await page.fill('#f_pw', 'newpass1'); await page.fill('#f_pw2', 'newpass1');
  const errsBefore = T.errors.length;
  await page.click('#f_go');
  await page.waitForFunction(() => document.getElementById('f_err').style.display === 'block', null, { timeout: 8000 }).catch(() => {});
  check('wrong code is rejected', /invalid or has expired/i.test(await page.innerText('#f_err')));
  // that 400 response (and the browser's console note about it) is the expected outcome
  for (let i = T.errors.length - 1; i >= errsBefore; i--) if (/400/.test(T.errors[i])) T.errors.splice(i, 1);
  await page.fill('#f_code', rc.code.toLowerCase());
  await page.click('#f_go');
  await page.waitForFunction(() => !document.getElementById('f_code'), null, { timeout: 8000 }).catch(() => {});
  check('correct code (any case) resets the password and signs in', !(await page.$('#f_code')));
  const reuse = await ctx.request.post(base + '/api/auth/reset', { data: { mobile, code: rc.code, password: 'again123' } });
  check('reset code is single-use', reuse.status() === 400);
  const oldLogin = await ctx.request.post(base + '/api/auth/login', { data: { mobile, password: 'firstpass' } });
  const newLogin = await ctx.request.post(base + '/api/auth/login', { data: { mobile, password: 'newpass1' } });
  check('old password no longer works, new one does', oldLogin.status() === 400 && newLogin.status() === 200);

  heading('Wishlist');
  await page.goto(base + '/shop', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#grid .card .wish');
  const wishName = (await page.innerText('#grid .card h3')).trim();
  await page.click('#grid .card .wish');
  await page.goto(base + '/wishlist', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(n => document.body.innerText.includes(n), wishName, { timeout: 8000 }).catch(() => {});
  check('heart → product appears in wishlist', (await page.innerText('body')).includes(wishName));

  heading('Custom design request (signed in)');
  await page.goto(base + '/custom-design', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#d_type', { timeout: 10000 });
  const opts = await page.$$eval('#d_type option', os => os.map(o => o.textContent));
  check('only poster options offered', !opts.some(o => /t-shirt|hoodie|combo/i.test(o)), opts.join(' | '));
  await page.selectOption('#d_type', { index: 1 });
  await page.fill('#d_qty', '1');
  await page.fill('#d_contact', mobile);
  await page.fill('#d_details', 'Six posters of my favourite band, A4, dark theme please.');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#d_files', { name: 'idea.html', mimeType: 'image/png', buffer: png });
  await page.click('#d_send');
  await page.waitForFunction(() => /HSS-D|D-|submitted/i.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  const designs = (await admin.get('/api/admin/designs')).designs || [];
  const mine = designs.find(d => d.mobile === mobile);
  check('design request reaches admin with the uploaded file', mine && mine.files.length === 1, JSON.stringify(mine && mine.files));
  check('upload stored with a safe extension (.png, not the client\'s .html)', mine && /\.png$/.test(mine.files[0]), mine && mine.files[0]);
  await ctx.close();
}

/* 6. Every admin module renders without errors */
async function adminModules(T) {
  const { browser, base, check, heading, ART } = T;
  heading('Admin — all 16 modules');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  T.watch(page, errors);
  await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  await page.fill('#u', 'hssadmin'); await page.fill('#p', 'admin123'); await page.click('#lbtn');
  await page.waitForSelector('#pane');
  const tabs = ['dash', 'analytics', 'products', 'cats', 'orders', 'inv', 'reviews', 'promos', 'coupons', 'customers', 'carts',
    'designs', 'home', 'content', 'pay', 'settings', 'pnew'];
  for (const t of tabs) {
    const before = errors.length;
    await page.evaluate(tab => window.GOTAB(tab), t);
    await page.waitForFunction(() => { const p = document.getElementById('pane'); return p && p.innerText.trim().length > 20 && !p.querySelector('.spin'); },
      null, { timeout: 10000 }).catch(() => {});
    const txt = (await page.innerText('#pane')).trim();
    const failed = /Could not load|Something went wrong|undefined|NaN|\[object Object\]/.test(txt);
    check(`${t}: renders without errors`, txt.length > 20 && !failed && errors.length === before,
      (failed ? 'text: ' + (txt.match(/Could not load|Something went wrong|undefined|NaN|\[object Object\]/) || [])[0] : '') + ' ' + errors.slice(before).join(' | '));
  }
  await page.evaluate(() => window.GOTAB('orders'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ART, 'admin-orders.png') });
  await ctx.close();
}

module.exports = { firstPaint, freshLoads, noFlicker, search, checkoutFlows, customerFlows, adminModules, phase3: require('./phase3'), MOJIBAKE };
