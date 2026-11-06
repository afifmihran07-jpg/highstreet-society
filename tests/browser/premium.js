'use strict';
/*
 * Premium upgrade checks: layout stability, light logo, artwork-first cards,
 * set-first gallery, quieter tags, compact reviews, fuller related sets,
 * clear cart/checkout totals, linked form labels, and "See it on your wall".
 * Runs on the throwaway server started by run.js (no production writes).
 */
const path = require('path');
const orig = src => (src || '').startsWith('/img?') ? new URLSearchParams(src.slice(5)).get('u') : src;

module.exports = async function premium(T) {
  const { browser, base, snap, check, heading, ART } = T;
  const errors = [];
  const published = snap.products.filter(p => p.published);
  const P = published.find(p => (p.posters || []).length === 6) || published[0];

  heading('Premium — layout stability & weight (desktop 1440)');
  const d = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await d.addInitScript(id => { try { localStorage.setItem('hss_cart', JSON.stringify([{ id, qty: 2 }])); } catch (e) {} }, P.id);
  await d.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {} });
  for (const u of ['/shop', '/shop?cat=' + (P.categoryIds || [])[0], '/product/' + P.slug, '/cart', '/checkout']) {
    const pg = await d.newPage(); T.watch(pg, errors);
    await pg.goto(base + u, { waitUntil: 'networkidle' }); await pg.waitForTimeout(800);
    const cls = await pg.evaluate(() => window.__cls);
    check(`${u}: layout shift ${cls.toFixed(3)} (good < 0.1)`, cls < 0.1, cls.toFixed(3));
    await pg.close();
  }
  const pg = await d.newPage(); T.watch(pg, errors);
  let logoBytes = 0;
  pg.on('response', async r => { if (/\/images\/logo/.test(r.url())) { try { logoBytes += (await r.body()).length; } catch (e) {} } });
  await pg.goto(base + '/shop', { waitUntil: 'networkidle' });
  check(`header/footer logo is the optimised file (${Math.round(logoBytes / 1024)} KB, was 201 KB)`, logoBytes > 0 && logoBytes < 40 * 1024 && !!(await pg.$('#hdr .logo img[src*="logo-240.webp"]')));
  check('favicon is a small icon, not the 201 KB logo', (await pg.$eval('link[rel=icon]', l => l.getAttribute('href'))).includes('favicon-64.png'));

  heading('Premium — artwork-first cards');
  const cards = await pg.$$eval('#grid .card', cs => cs.map(c => ({ name: c.querySelector('h3').textContent.trim(), wall: c.classList.contains('card-wall'),
    imgs: [...c.querySelectorAll('.pwall img')].map(i => i.getAttribute('src')), tagOnArt: !!c.querySelector('.ph .ptag'), wishOnArt: !!c.querySelector('.ph ~ .wish'), loaded: [...c.querySelectorAll('.pwall img')].every(i => i.complete && i.naturalWidth > 0) })));
  const bad = cards.filter(c => { const p = published.find(x => x.name === c.name); return !p || (p.posters || []).length === 6 && (!c.wall || JSON.stringify(c.imgs.map(orig)) !== JSON.stringify(p.posters)); });
  check(`every set card shows its own six posters (${cards.length} cards)`, cards.length === published.length && !bad.length, bad.map(b => b.name).join(', '));
  check('nothing sits on the artwork (tag + heart moved off the image)', cards.every(c => !c.tagOnArt && !c.wishOnArt));
  await pg.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } });
  await pg.waitForTimeout(800);
  check('all card poster images load', await pg.$$eval('#grid .pwall img', is => is.every(i => i.complete && i.naturalWidth > 0)));
  const tags = await pg.$$eval('#grid .ptag', ts => ts.map(t => t.textContent.trim()));
  check('cards keep their original discount badges (off the artwork)', tags.length > 0 && tags.every(t => /^-\d+%$|^(NEW|BESTSELLER|SOLD OUT)$/.test(t)), [...new Set(tags)].join(','));

  heading('Premium — product page (set view, related, reviews, wall)');
  await pg.goto(base + '/product/' + P.slug, { waitUntil: 'networkidle' });
  check('main action is Add to Cart; Buy Now is secondary; Wishlist is a quiet icon button',
    !!(await pg.$('#mainbuy .btn-lime')) && !!(await pg.$('.wishrow .btn-ghost')) && !!(await pg.$('.wishrow .iconbtn[aria-label]')) && !(await pg.$('.btn-brand')));
  check('original SAVE % chip kept', /SAVE \d+%/.test(await pg.innerText('.pricerow')), await pg.innerText('.pricerow'));
  await pg.waitForSelector('.rail .card');
  const rel = await pg.$$eval('.rail .card', cs => cs.length);
  check(`"Complete the wall" shows a full row (${rel} sets)`, rel >= Math.min(8, published.length - 1));
  check('no reviews: one compact line, the form is folded away', !(await pg.isVisible('#rvform')) && /Be the first to review|out of 5/.test(await pg.innerText('#rvsec')));
  await pg.click('#rv_open');
  check('"Write a review" opens the form with linked labels', await pg.isVisible('#rvform') && await pg.$eval('label[for="rv_n"]', l => !!l));
  await pg.click('.gtabs [data-mode="wall"]'); await pg.waitForTimeout(900);
  const wall = await pg.evaluate(() => ({ n: document.querySelectorAll('#wallscene .wp').length, src: [...document.querySelectorAll('#wallscene .wp img')].map(i => i.getAttribute('src')),
    note: document.getElementById('wnote').textContent, thumbs: getComputedStyle(document.getElementById('gthumbs')).display,
    ratio: (() => { const r = document.querySelector('#wallscene .wp').getBoundingClientRect(); return +(r.height / r.width).toFixed(2); })() }));
  check('wall view hangs the set\'s own six posters at A4 proportions', wall.n === 6 && JSON.stringify(wall.src.map(orig)) === JSON.stringify(P.posters) && Math.abs(wall.ratio - 1.41) < 0.04, JSON.stringify({ n: wall.n, ratio: wall.ratio }));
  check('wall view states the true size (73 × 64 cm for 3 × 2)', /73 × 64 cm/.test(wall.note) && wall.thumbs === 'none', wall.note);
  await pg.click('[data-k="layout"] [data-v="row"]'); await pg.waitForTimeout(300);
  check('layout switch updates the size (row of 6 → 151 × 30 cm)', /151 × 30 cm/.test(await pg.innerText('#wnote')));
  await pg.click('[data-k="tone"] [data-v="charcoal"]'); await pg.uncheck('#w_sofa'); await pg.waitForTimeout(300);
  check('wall colour and sofa toggle apply', !!(await pg.$('#wallscene.tone-charcoal')) && !(await pg.$('#wallscene .sofa')));
  await pg.screenshot({ path: path.join(ART, 'premium-wall-desktop.png') });
  await pg.click('#wallscene .wp[data-n="3"]'); await pg.waitForTimeout(400);
  check('tapping a print on the wall opens that poster in the gallery', /Poster 3 \/ 6/.test(await pg.innerText('#gcount')) && !(await pg.$('#wallscene')));
  await d.close();

  heading('Premium — cart & checkout clarity, labels (390 px)');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.addInitScript(id => { try { localStorage.setItem('hss_cart', JSON.stringify([{ id, qty: 2 }])); } catch (e) {} }, P.id);
  const mp = await m.newPage(); T.watch(mp, errors);
  await mp.goto(base + '/cart', { waitUntil: 'networkidle' });
  const sum = await mp.innerText('#sum');
  check('cart shows one estimated total (no "৳…+", no double delivery lines)', /Estimated total|Total/.test(sum) && !/\+\s*$/m.test(sum) && !/Outside Dhaka\)/.test(sum), sum.replace(/\s+/g, ' ').slice(0, 160));
  await mp.goto(base + '/checkout', { waitUntil: 'networkidle' });
  const cs = await mp.innerText('#cosum');
  check('checkout: compact summary bar at the top on phones', /item/.test(cs) && /৳/.test(cs) && await mp.isVisible('#cosum'), cs);
  check('checkout: delivery waits for the district instead of guessing', /Select your district/.test(await mp.innerText('#sum')));
  const unlabeled = await mp.$$eval('.fld', fs => fs.filter(f => { const l = f.querySelector(':scope > label'); const c = f.querySelector('input:not([type=hidden]),select,textarea'); return l && c && l.htmlFor !== c.id; }).length);
  check('checkout: every field label is connected to its field', unlabeled === 0, String(unlabeled));
  await mp.goto(base + '/product/' + P.slug, { waitUntil: 'networkidle' });
  await mp.tap('.gtabs [data-mode="wall"]'); await mp.waitForTimeout(800);
  check('wall view fits a 390 px phone with no sideways scroll', await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1 && (await mp.$$('#wallscene .wp')).length === 6);
  await mp.screenshot({ path: path.join(ART, 'premium-wall-mobile.png') });
  await m.close();

  check('no JS errors, console errors or failed requests (premium)', !errors.length, errors.slice(0, 4).join(' || '));
};
