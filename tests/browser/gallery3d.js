'use strict';
/* 3D floating poster gallery: placement, real catalogue artwork, product links,
   keyboard access, reduced motion, overflow, no blocking of hero controls.
   Runs before phase3.js (which rewrites the homepage copy on the test server). */
const path = require('path');

module.exports = async function gallery3d(T) {
  const { browser, base, snap, check, heading, ART } = T;
  const errors = [];
  const published = snap.products.filter(p => p.published);
  const bySlug = Object.fromEntries(published.map(p => [p.slug, p]));
  const VIEWS = [['desktop', { width: 1280, height: 900 }, 11], ['tablet', { width: 768, height: 1024 }, 11],
                 ['mobile', { width: 390, height: 844, isMobile: true, hasTouch: true }, 7]];

  for (const [name, vp, expectCards] of VIEWS) {
    heading(`3D poster gallery — ${name}`);
    const { isMobile, hasTouch, ...viewport } = vp;
    const ctx = await browser.newContext({ viewport, isMobile, hasTouch });
    const page = await ctx.newPage();
    T.watch(page, errors);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.g3d-card img');
    await page.$eval('#g3d', s => s.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const kids = [...document.getElementById('content').children].map(e => e.className.split(' ')[0]);
      const cards = [...document.querySelectorAll('.g3d-card')].map(a => {
        const img = a.querySelector('img');
        const u = new URL(img.currentSrc || img.src, location.href);
        return { href: a.getAttribute('href'), label: a.getAttribute('aria-label'),
          src: u.pathname === '/img' ? u.searchParams.get('u') : u.href, ok: img.complete && img.naturalWidth > 0 };
      });
      return { kids, cards, overflow: document.documentElement.scrollWidth - innerWidth, inView: document.getElementById('g3d').classList.contains('in') };
    });
    check('gallery sits immediately after the hero; other sections keep their order',
      info.kids[0] === 'hero2' && info.kids[1] === 'g3d' && info.kids[2] === 'marquee', info.kids.join(' > '));
    check(`${expectCards} posters shown`, info.cards.length === expectCards, String(info.cards.length));
    const wrong = info.cards.filter(c => {
      const slug = decodeURIComponent((c.href || '').replace(/^\/product\//, ''));
      const p = bySlug[slug];
      return !p || ![...(p.posters || []), p.cover].includes(c.src);
    });
    check('every poster is real artwork of the set it links to (/product/<slug>)', !wrong.length, JSON.stringify(wrong.slice(0, 2)));
    check('all gallery images load', info.cards.every(c => c.ok), info.cards.filter(c => !c.ok).map(c => c.src).join(', '));
    check('posters have accessible names', info.cards.every(c => /view this poster set/.test(c.label || '')));
    check('no horizontal overflow', info.overflow <= 1, String(info.overflow));
    check('entrance animation ran (gallery revealed)', info.inView);
    await (await page.$('#g3d')).screenshot({ path: path.join(ART, `gallery3d-${name}.png`) });

    // hero buttons stay clickable (the gallery never covers them)
    await page.evaluate(() => scrollTo(0, 0));
    const ctaFree = await page.$eval('.hero2 .cta .btn', b => { const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
    check('hero buttons are not covered', ctaFree);

    // click / tap the front-most poster → its product page
    await page.$eval('#g3d', s => s.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    const target = await page.evaluate(() => {
      const st = document.querySelector('.g3d-stage').getBoundingClientRect();
      const el = document.elementFromPoint(st.left + st.width / 2, st.top + st.height / 2);
      const a = el && el.closest('.g3d-card');
      return a ? a.getAttribute('href') : null;
    });
    const tp = target && bySlug[decodeURIComponent(target.replace('/product/', ''))];
    if (hasTouch) await page.tap(`.g3d-card[href="${target}"]`); else await page.click(`.g3d-card[href="${target}"]`);
    await page.waitForSelector('.pinfo h1', { timeout: 15000 }).catch(() => {});
    check(`${hasTouch ? 'tapping' : 'clicking'} a poster opens its product page`,
      !!tp && page.url().endsWith(target) && (await page.innerText('.pinfo h1').catch(() => '')).trim() === tp.name, page.url());
    if (name === 'desktop') {
      // keyboard: Tab to the gallery, Enter opens the focused poster
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      await page.waitForSelector('.g3d-card img');
      await page.focus('.g3d-card');
      const focused = await page.evaluate(() => document.activeElement.getAttribute('href'));
      await page.keyboard.press('Enter');
      await page.waitForSelector('.pinfo h1', { timeout: 15000 }).catch(() => {});
      check('keyboard: Enter on a focused poster opens its product page', !!focused && page.url().endsWith(focused), page.url());
    }
    await ctx.close();
  }

  heading('3D poster gallery — reduced motion & admin switch');
  const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const r = await rctx.newPage(); T.watch(r, errors);
  await r.goto(base + '/', { waitUntil: 'networkidle' });
  await r.waitForSelector('.g3d-card img');
  const rm = await r.evaluate(() => ({ anim: [...document.querySelectorAll('.g3d-float')].map(e => getComputedStyle(e).animationName),
    op: [...document.querySelectorAll('.g3d-card')].map(e => getComputedStyle(e).opacity) }));
  check('prefers-reduced-motion: no floating animation, posters fully visible',
    rm.anim.length > 0 && rm.anim.every(a => a === 'none') && rm.op.every(o => o === '1'), JSON.stringify(rm).slice(0, 120));
  // admin "Visible sections" switch hides it (throwaway server), then restore
  const login = await rctx.request.post(base + '/api/admin/login', { data: { username: 'hssadmin', password: 'admin123' } });
  const H = { Authorization: 'Bearer ' + (await login.json()).token };
  await rctx.request.put(base + '/api/admin/homepage', { headers: H, data: { showSections: { gallery: false } } });
  await r.goto(base + '/', { waitUntil: 'networkidle' });
  check('Admin → Homepage → "3D poster gallery" switch hides it', !(await r.$('#g3d')) && !!(await r.$('.marquee')));
  await rctx.request.put(base + '/api/admin/homepage', { headers: H, data: { showSections: { gallery: true } } });
  await rctx.close();

  check('no JS errors, console errors or failed requests (gallery)', !errors.length, errors.slice(0, 4).join(' || '));
};
