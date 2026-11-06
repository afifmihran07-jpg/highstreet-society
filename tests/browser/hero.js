'use strict';
/*
 * Homepage hero: dynamic poster collage (public/js/hero-collage.js).
 * - layout on desktop / laptop / tablet / phone / narrow phone: posters whole
 *   (never cropped), inside the stage, clear of the hero text and WhatsApp button,
 *   no layout shift, text usable while the entrance plays;
 * - repeated refreshes give different combinations and moods;
 * - only the chosen posters are downloaded;
 * - reduced motion, and the static-collage fallback;
 * - catalogue sync on the throwaway server: a new published set joins, a
 *   missing image is dropped, hidden and deleted sets leave. The test set is
 *   deleted again afterwards. No production data is touched.
 */
const path = require('path');

module.exports = async function hero(T) {
  const { browser, base, check, heading, ART } = T;
  const errors = [];
  const api = async () => (await (await fetch(base + '/api/hero-posters')).json());
  const live = async () => (await (await fetch(base + '/api/products?limit=200')).json()).items;
  const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;

  heading('Hero collage — catalogue source');
  let d = await api();
  const prods = await live();
  const expected = prods.filter(p => p.published !== false).reduce((n, p) => n + (p.posters || []).filter(Boolean).length, 0);
  check(`lists every poster of every published set (${d.posters.length} posters)`, d.posters.length === expected && d.posters.every(x => prods.some(p => p.id === x.id && (p.posters || []).includes(x.u))));
  // tones are measured in the background — give it a moment on a cold cache
  for (let i = 0; i < 60 && d.posters.some(x => !x.t); i++) { await new Promise(r => setTimeout(r, 1000)); d = await api(); }
  check('every poster has a measured colour tone', d.posters.every(x => x.t && x.t.ar > 1), d.posters.filter(x => !x.t).length + ' unmeasured');

  const VIEWS = [['desktop', { width: 1440, height: 900 }, [6, 7]], ['laptop', { width: 1280, height: 800 }, [6, 7]],
    ['tablet', { width: 768, height: 1024 }, [5, 5]], ['mobile', { width: 390, height: 844, touch: true }, [5, 5]],
    ['narrow phone', { width: 320, height: 640, touch: true }, [5, 5]]];
  for (const [name, vp, [lo, hi]] of VIEWS) {
    heading(`Hero collage — ${name} (${vp.width}px)`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.touch, hasTouch: !!vp.touch });
    await ctx.addInitScript(() => {
      window.__cls = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
      // the moment posters appear (entrance starting), is the hero text already usable?
      new MutationObserver((_, ob) => { if (!document.querySelector('.hc-p')) return; ob.disconnect();
        const b = document.querySelector('.hero2 .cta .btn').getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const st = document.querySelector('.hc-stage');
        window.__early = { cta: !!(hit && hit.closest('.cta')), h1: getComputedStyle(document.querySelector('.hero2 h1')).opacity, stageH: st.getBoundingClientRect().height };
      }).observe(document, { childList: true, subtree: true });
    });
    const page = await ctx.newPage(); T.watch(page, errors);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => {
      const st = document.querySelector('.hc-stage'), R = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const ps = [...st.querySelectorAll('.hc-p')].map(a => { const im = a.querySelector('img'), f = a.querySelector('.hc-f');
        return { ok: im.complete && im.naturalWidth > 0, nat: im.naturalHeight / im.naturalWidth, shown: im.offsetHeight / im.offsetWidth, px: 1.5 / im.offsetWidth,
          frame: f.offsetHeight - im.offsetHeight, l: a.offsetLeft, r: a.offsetLeft + a.offsetWidth, t: a.offsetTop, b: a.offsetTop + a.offsetHeight, box: R(a.getBoundingClientRect()), href: a.getAttribute('href') }; });
      const fab = document.getElementById('wafab');
      return { mood: st.dataset.mood, tpl: st.dataset.tpl, W: st.offsetWidth, H: st.offsetHeight, stageH: st.getBoundingClientRect().height, ps,
        text: [...document.querySelectorAll('.hero2-tx h1, .hero2-tx p, .hero2-tx .cta, .hero2-tx .pill, .hero2-kv')].map(e => R(e.getBoundingClientRect())),
        fab: fab ? R(fab.getBoundingClientRect()) : null, cls: window.__cls, early: window.__early, ov: document.documentElement.scrollWidth - innerWidth };
    });
    check(`${s.ps.length} posters (${lo}–${hi}) — mood "${s.mood}", layout "${s.tpl}", all loaded`, s.ps.length >= lo && s.ps.length <= hi && s.ps.every(p => p.ok));
    check('artwork shown whole: every frame takes the image\'s own aspect ratio (no crop)', s.ps.every(p => Math.abs(p.shown - p.nat) <= Math.max(.01, p.px) && Math.abs(p.frame) <= 1), JSON.stringify(s.ps.map(p => [p.nat.toFixed(3), p.shown.toFixed(3), p.frame])));
    check('every poster sits inside the stage', s.ps.every(p => p.l >= -1 && p.r <= s.W + 1 && p.t >= -2 && p.b <= s.H + 2), JSON.stringify(s.ps.map(p => [p.l, p.r, p.t, p.b])) + ` stage ${s.W}×${s.H}`);
    check('no poster covers the hero text or buttons', s.ps.every(p => s.text.every(t => !overlap(p.box, t))));
    check('WhatsApp button stays clear of the collage', !s.fab || s.ps.every(p => !overlap(p.box, s.fab)));
    check('every poster links to its set', s.ps.every(p => /^\/product\/[\w-]+$/.test(p.href)));
    // first visit (fresh browser): a pink editorial mix from at least three sets
    const sets = new Set(s.ps.map(p => p.href)).size;
    check(`first visit is the pink collection (mood "${s.mood}", ${sets} different sets)`, s.mood === 'pink' && sets >= 3);
    // compact: one connected cluster (every poster overlaps another), centred, no stray poster
    const ov = s.ps.map((p, i) => s.ps.some((q, j) => j !== i && overlap(p.box, q.box)));
    const bx = { l: Math.min(...s.ps.map(p => p.l)), r: Math.max(...s.ps.map(p => p.r)), t: Math.min(...s.ps.map(p => p.t)), b: Math.max(...s.ps.map(p => p.b)) };
    const conn = (() => { const seen = new Set([0]), q = [0]; while (q.length) { const i = q.pop(); s.ps.forEach((p, j) => { if (!seen.has(j) && overlap(s.ps[i].box, p.box)) { seen.add(j); q.push(j); } }); } return seen.size; })();
    check('compact cluster: every poster overlaps a neighbour, all connected, centred in the stage',
      ov.every(Boolean) && conn === s.ps.length && Math.abs((bx.l + bx.r) / 2 - s.W / 2) < s.W * .04 && Math.abs((bx.t + bx.b) / 2 - s.H / 2) < s.H * .06,
      JSON.stringify({ ov, conn, bx, W: s.W, H: s.H }));
    check(`no layout shift while it animates (CLS ${s.cls.toFixed(3)}) and the stage was reserved up front`, s.cls < .02 && s.early && Math.abs(s.early.stageH - s.stageH) < 1, JSON.stringify(s.early));
    check('headline and buttons are visible and clickable while the entrance plays', s.early && s.early.cta && s.early.h1 === '1');
    check('no sideways scroll', s.ov <= 1, String(s.ov));
    await (await page.$('.hero2')).screenshot({ path: path.join(ART, `hero-collage-${name.replace(' ', '-')}.png`) });

    if (name === 'desktop') {
      heading('Hero collage — repeated refreshes (desktop)');
      const seen = [{ mood: s.mood, sig: s.ps.map(p => p.href).join() }];
      const sigs = [], moods = [s.mood];
      for (let k = 0; k < 6; k++) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
        const r = await page.evaluate(() => { const st = document.querySelector('.hc-stage');
          return { mood: st.dataset.mood, us: [...st.querySelectorAll('.hc-p')].map(a => a.dataset.u) }; });
        sigs.push(r.us.slice().sort().join('|')); moods.push(r.mood);
      }
      console.log('    moods: ' + moods.join(' → '));
      check('six refreshes → six different combinations', new Set(sigs).size === sigs.length);
      check('the mood never repeats on consecutive visits', moods.every((m, i) => !i || m !== moods[i - 1]), moods.join(','));
      // image economy: the exhibition below also uses 400 px images, so stub it out to count the hero alone
      const nctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await nctx.route(u => u.pathname === '/api/exhibition', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"sets":[]}' }));
      const np = await nctx.newPage();
      await np.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await np.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
      await np.waitForTimeout(500);
      const net = await np.evaluate(() => ({ us: [...document.querySelectorAll('.hc-p')].map(a => a.dataset.u),
        got: performance.getEntriesByType('resource').filter(e => /\/img\?w=400&/.test(e.name)).map(e => new URL(e.name).searchParams.get('u')) }));
      check(`only the chosen posters are downloaded (${net.got.length} images for ${net.us.length} posters, of ${d.posters.length} in the catalogue)`,
        net.got.length === net.us.length && net.us.every(u => net.got.includes(u)));
      await nctx.close();
    }
    await ctx.close();
  }

  heading('Hero collage — a poster that fails to load is replaced');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let killed = '';
    await ctx.route(u => u.pathname === '/img' && u.searchParams.get('w') === '400', r => { if (!killed) { killed = new URL(r.request().url()).searchParams.get('u'); return r.abort(); } return r.continue(); });
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
    const r = await page.evaluate(() => [...document.querySelectorAll('.hc-p')].map(a => ({ u: a.dataset.u, ok: a.querySelector('img').naturalWidth > 0 })));
    check('a failed image is swapped for a spare: full collage, no broken image', r.length >= 6 && r.every(x => x.ok) && !r.some(x => x.u === killed));
    await ctx.close();
  }

  heading('Hero collage — reduced motion & fallback');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage(); T.watch(page, errors);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
    const m = await page.evaluate(() => ({ anims: document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.hc-stage') && a.playState === 'running').map(a => a.animationName || 'waapi'),
      tr: getComputedStyle(document.querySelector('.hc-p')).translate }));
    check('prefers-reduced-motion: a plain fade — no flight, float or parallax', !m.anims.length && (m.tr === 'none' || m.tr === '0px'), JSON.stringify(m));
    await ctx.close();
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c2.route('**/api/hero-posters', r => r.fulfill({ status: 503, body: '{}', contentType: 'application/json' }));
    const p2 = await c2.newPage();
    await p2.goto(base + '/', { waitUntil: 'networkidle' });
    check('if the catalogue can\'t be read, the original static collage is shown', await p2.$eval('.hero2-art img', i => i.complete && i.naturalWidth > 0 && /hero-collage/.test(i.currentSrc)).catch(() => false));
    await c2.close();
  }

  heading('Hero collage — stays in sync with the catalogue (throwaway server)');
  const actx = await browser.newContext();
  const login = await actx.request.post(base + '/api/admin/login', { data: { username: 'hssadmin', password: 'admin123' } });
  check('local admin login', login.ok());
  const POSTERS = [1, 2, 3, 4, 5].map(i => `/images/products/cherry-bomb/p${i}.webp`).concat('/images/products/cherry-bomb/missing-p6.webp');
  const created = await (await actx.request.post(base + '/api/admin/products', { data: { name: 'Hero Sync Test Set', price: 420, stock: 5, type: 'poster',
    cover: '/images/products/cherry-bomb/cover.webp', posters: POSTERS, categoryIds: ['her'], published: true } })).json();
  const id = created.product && created.product.id;
  check('new set published through Admin', !!id, JSON.stringify(created).slice(0, 160));
  const mine = x => x.id === id;
  d = await api();
  check('its posters join the hero catalogue immediately', d.posters.filter(mine).length >= 5);
  for (let i = 0; i < 30 && (d.posters.filter(mine).some(x => !x.t) || d.posters.some(x => x.u === POSTERS[5])); i++) { await new Promise(r => setTimeout(r, 500)); d = await api(); }
  check('their tones are measured automatically', d.posters.filter(mine).length === 5 && d.posters.filter(mine).every(x => x.t));
  check('the missing image is dropped, the other five stay', !d.posters.some(x => x.u === POSTERS[5]));
  // the browser's own composer, run many times on the live list: the new set takes part
  const page = await actx.newPage();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
  const runs = async () => page.evaluate(async () => { const d = await (await fetch('/api/hero-posters')).json(); const out = [];
    for (let i = 0; i < 60; i++) { const c = HSSHeroCollage.compose(JSON.parse(JSON.stringify(d.posters)), d.cats, 8); out.push(...c.posters.map(p => p.id)); }
    return out; });
  let picks = await runs();
  check(`new set appears in fresh combinations (${picks.filter(x => x === id).length} picks in 60 compositions)`, picks.includes(id));
  await actx.request.post(base + '/api/admin/products/bulk', { data: { ids: [id], action: 'hide' } });
  d = await api(); picks = await runs();
  check('hidden (unpublished) set: gone from the catalogue and from new combinations', !d.posters.some(mine) && !picks.includes(id));
  await actx.request.post(base + '/api/admin/products/bulk', { data: { ids: [id], action: 'publish' } });
  d = await api();
  check('published again: it returns', d.posters.filter(mine).length === 5);
  const del = await actx.request.delete(base + '/api/admin/products/' + id);
  d = await api(); picks = await runs();
  check('deleted set: gone everywhere', del.ok() && !d.posters.some(mine) && !picks.includes(id));
  // a real page load after deletion never shows it
  let shown = false;
  for (let k = 0; k < 4; k++) { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 });
    shown = shown || await page.$$eval('.hc-p', as => as.some(a => a.dataset.u.includes('cherry-bomb'))); }
  check('four homepage loads after deletion: never shown', !shown);
  check('product count back to the original', (await live()).length === prods.length);

  // a custom hero image saved in Admin → Homepage still wins over the collage
  const before = (await (await actx.request.get(base + '/api/admin/homepage')).json()).homepage.hero.image;
  const CUSTOM = '/images/hero-banner.webp';
  await actx.request.put(base + '/api/admin/homepage', { data: { hero: { image: CUSTOM } } });
  await page.reload({ waitUntil: 'networkidle' });
  const ov = await page.evaluate(() => ({ stage: !!document.querySelector('.hc-stage'), img: (document.querySelector('.hero2-art img') || {}).currentSrc || '',
    ok: !!document.querySelector('.hero2-art img') && document.querySelector('.hero2-art img').naturalWidth > 0 }));
  check('custom hero image from Admin overrides the collage', !ov.stage && ov.ok && ov.img.includes('hero-banner'), JSON.stringify(ov));
  await actx.request.put(base + '/api/admin/homepage', { data: { hero: { image: before || '' } } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('clearing it brings the dynamic collage back', !!(await page.waitForSelector('.hc-stage.hc-live', { timeout: 30000 }).catch(() => null))
    && (await (await actx.request.get(base + '/api/admin/homepage')).json()).homepage.hero.image === (before || ''));
  await actx.close();

  check('no JS errors, console errors or failed requests (hero collage)', !errors.length, errors.slice(0, 4).join(' || '));
};
