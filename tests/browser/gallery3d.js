'use strict';
/* Poster exhibition (homepage 3D gallery): one slide per set, six posters each,
   per-poster info (hover / tap), dots + arrows (circular), lightbox, keyboard,
   purchase links, responsive layouts, reduced motion, and the Admin screen.
   Runs before phase3.js (which rewrites the homepage copy on the test server). */
const path = require('path');

module.exports = async function exhibition(T) {
  const { browser, base, check, heading, ART } = T;
  const errors = [];
  const ex = await (await fetch(base + '/api/exhibition')).json();
  const N = ex.sets.length;
  const VIEWS = [['desktop', { width: 1280, height: 900 }], ['tablet', { width: 768, height: 1024 }],
    ['mobile', { width: 390, height: 844, touch: true }], ['narrow phone', { width: 320, height: 640, touch: true }]];

  const state = page => page.evaluate(() => {
    const st = document.querySelector('.g3d-stage').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.g3d-card:not(.leave)')].map(a => {
      const img = a.querySelector('img'), r = a.querySelector('.g3d-inner').getBoundingClientRect();
      const u = new URL(img.currentSrc || img.src, location.href);
      return { p: +a.dataset.p, href: a.getAttribute('href'), src: u.searchParams.get('u') || u.href, ok: img.complete && img.naturalWidth > 0,
        r: { l: r.left, t: r.top, rr: r.right, b: r.bottom, w: r.width, h: r.height } };
    });
    return { st: { l: st.left, t: st.top, r: st.right, b: st.bottom }, cards,
      count: document.querySelector('.g3d-count').textContent, title: document.querySelector('.g3d-title').textContent,
      dots: document.querySelectorAll('.g3d-dot').length, on: [...document.querySelectorAll('.g3d-dot')].findIndex(d => d.classList.contains('on')),
      infoT: (document.querySelector('.g3d-tip.on b') || {}).textContent, infoX: (document.querySelector('.g3d-tip.on p') || {}).textContent,
      tipP: (document.querySelector('.g3d-tip.on') || { dataset: {} }).dataset.p,
      tipIn: (() => { const t = document.querySelector('.g3d-tip.on .g3d-tip-tx'); if (!t) return null; const a = t.getBoundingClientRect(), b = document.querySelector('.g3d-stage').getBoundingClientRect();
        return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1; })(),
      marker: document.querySelectorAll('.g3d-tip .g3d-mark path').length,
      panel: !!document.querySelector('.g3d-info'),
      kids: [...document.getElementById('content').children].map(e => e.className.split(' ')[0]),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const settle = page => page.waitForTimeout(900);
  const pad = n => String(n).padStart(2, '0');

  for (const [name, vp] of VIEWS) {
    heading(`Poster exhibition — ${name} (${vp.width}px)`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.touch, hasTouch: !!vp.touch });
    const page = await ctx.newPage();
    T.watch(page, errors);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.g3d-card img');
    await page.$eval('#g3d', s => s.scrollIntoView({ block: 'start' }));
    await settle(page); await page.waitForTimeout(600);
    let s = await state(page);
    const first = ex.sets[0];
    check('exhibition sits right after the hero; other sections keep their order', s.kids[0] === 'hero2' && s.kids[1] === 'g3d' && s.kids[2] === 'marquee', s.kids.join(' > '));
    check(`one dot per set (${N}) and the first set opens by default (01 / ${pad(N)})`, s.dots === N && s.count === `01 / ${pad(N)}` && s.on === 0 && s.title === first.name, `${s.dots} ${s.count} ${s.title}`);
    check(`all ${first.posters.length} posters of "${first.name}" are on screen at once`,
      s.cards.length === first.posters.length && s.cards.every(c => c.r.l >= s.st.l - 1 && c.r.rr <= s.st.r + 1 && c.r.t >= s.st.t - 1 && c.r.b <= s.st.b + 1 && c.r.w > 50),
      JSON.stringify(s.cards.map(c => Math.round(c.r.w))));
    check('posters are the set\'s own original artwork, every image loads', s.cards.every(c => first.posters[c.p].url === c.src && c.ok));
    check('every poster leads to the set\'s product page', s.cards.every(c => c.href === '/product/' + encodeURIComponent(first.slug)));
    check('no horizontal overflow', s.overflow <= 1, String(s.overflow));
    const navHits = await page.evaluate(() => { const els = [...document.querySelectorAll('.g3d-title,.g3d-count,.g3d-arrow,.g3d-dots,.g3d-cta,.g3d-all')].map(e => e.getBoundingClientRect());
      let n = 0; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], c = els[j];
        if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1) n++; } return n; });
    check('navigation controls do not overlap', navHits === 0, String(navHits));
    if (vp.touch) {
      let maxOv = 0;
      for (let i = 0; i < s.cards.length; i++) for (let j = i + 1; j < s.cards.length; j++) {
        const a = s.cards[i].r, b = s.cards[j].r;
        const w = Math.min(a.rr, b.rr) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (w > 0 && h > 0) maxOv = Math.max(maxOv, w * h);
      }
      check('touch targets do not overlap (2 × 3 layout)', maxOv === 0, String(maxOv));
      // tap each poster → its own info + selected outline; no navigation
      const seen = [];
      for (const c of s.cards) {
        await page.tap(`.g3d-card[data-p="${c.p}"]`);
        await page.waitForTimeout(150);
        const st = await page.evaluate(p => ({ t: (document.querySelector('.g3d-tip.on b') || {}).textContent, x: (document.querySelector('.g3d-tip.on p') || {}).textContent,
          sel: document.querySelector('.g3d-card.sel') && +document.querySelector('.g3d-card.sel').dataset.p, url: location.pathname }), c.p);
        const want = first.posters[c.p];
        seen.push(st.t === (want.title || `Poster ${c.p + 1}`) && st.x === want.text && st.sel === c.p && st.url === '/');
      }
      check('tap reveals each poster\'s own info and marks it selected (no accidental navigation)', seen.every(Boolean), JSON.stringify(seen));
      await page.screenshot({ path: path.join(ART, `exhibition-${name.replace(' ', '-')}.png`), fullPage: false });
      const cap = await page.evaluate(() => {
        const t = document.querySelector('.g3d-tip.on'); if (!t) return null;
        const r = t.getBoundingClientRect(), st = document.querySelector('.g3d-stage').getBoundingClientRect();
        const covers = [...document.querySelectorAll('.g3d-card:not(.leave) .g3d-inner')].filter(e => { const c = e.getBoundingClientRect();
          return Math.min(r.right, c.right) - Math.max(r.left, c.left) > 0 && Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top) > 0; }).length;
        return { below: r.top >= st.bottom - 1, covers, marker: t.querySelectorAll('.g3d-mark path').length,
          cornerMark: getComputedStyle(document.querySelector('.g3d-card.sel .g3d-inner'), '::after').backgroundImage.includes('svg') };
      });
      check('touch: marker + info show in a caption below the posters, covering none of them', !!cap && cap.below && cap.covers === 0 && cap.marker === 3, JSON.stringify(cap));
      check('touch: the selected poster carries a small marker on its corner', !!cap && cap.cornerMark);
      await page.tap('.g3d-tip .g3d-zoom');
      await page.waitForSelector('.g3d-lb.open', { timeout: 5000 }).catch(() => {});
      check('"View larger" on the poster opens the lightbox (touch)', !!(await page.$('.g3d-lb.open')));
      await page.tap('.g3d-lb-x');
      await page.tap(`.g3d-card[data-p="${s.cards[0].p}"]`); await page.waitForTimeout(200);
      await page.tap('.g3d-tip .g3d-go');
      await page.waitForSelector('.pinfo h1', { timeout: 15000 }).catch(() => {});
      check('"Explore set" opens the correct product page', page.url().endsWith('/product/' + first.slug));
    } else {
      // hover each poster → its own info
      const seen = [];
      for (const c of s.cards) {
        // the scene tilts with the mouse (parallax), so re-aim until the pointer rests on the poster
        for (let k = 0; k < 4; k++) {
          const b = await (await page.$(`.g3d-card[data-p="${c.p}"] .g3d-inner`)).boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); await page.waitForTimeout(350);
        }
        const st = await state(page); const want = first.posters[c.p];
        seen.push(st.infoT === (want.title || `Poster ${c.p + 1}`) && st.infoX === want.text);
      }
      check('hovering each poster shows its own title and description', seen.every(Boolean), JSON.stringify(seen));
      const tipS = await state(page);
      check('hover shows the 3-stroke geometric marker on that poster, overlay inside the stage, no panel below',
        tipS.marker === 3 && tipS.tipIn === true && !tipS.panel && +tipS.tipP === s.cards[s.cards.length - 1].p, JSON.stringify({ m: tipS.marker, in: tipS.tipIn, p: tipS.tipP }));
      await page.mouse.move(5, 5); await page.waitForTimeout(700);
      check('marker and info disappear when the pointer leaves', !(await page.$('.g3d-tip.on')));
      check('the six descriptions are all different', new Set(first.posters.map(p => p.text)).size === first.posters.length);
      await (await page.$('#g3d')).screenshot({ path: path.join(ART, `exhibition-${name}.png`) });
      if (name === 'desktop') {
        // navigation: next, previous, circular, every dot
        await page.click('.g3d-arrow[data-dir="1"]'); await settle(page);
        s = await state(page);
        check('Next → set 02', s.count === `02 / ${pad(N)}` && s.title === ex.sets[1].name && s.cards.every(c => ex.sets[1].posters[c.p].url === c.src));
        await page.click('.g3d-arrow[data-dir="-1"]'); await page.click('.g3d-arrow[data-dir="-1"]'); await settle(page);
        s = await state(page);
        check(`Previous from 01 wraps to ${pad(N)} (circular)`, s.count === `${pad(N)} / ${pad(N)}` && s.title === ex.sets[N - 1].name);
        await page.click('.g3d-arrow[data-dir="1"]'); await settle(page);
        check(`Next from ${pad(N)} wraps to 01`, (await state(page)).count === `01 / ${pad(N)}`);
        const bad = [];
        for (let i = 0; i < N; i++) {
          await page.click(`.g3d-dot[data-i="${i}"]`); await page.waitForTimeout(80);
          const st = await state(page);
          if (st.title !== ex.sets[i].name || st.on !== i || !st.cards.every(c => ex.sets[i].posters[c.p].url === c.src && c.href === '/product/' + encodeURIComponent(ex.sets[i].slug)))
            bad.push(i + 1);
        }
        check(`every one of the ${N} dots shows its own set (only that set's posters, correct links)`, !bad.length, bad.join(','));
        await settle(page);
        const allImgs = await page.$$eval('.g3d-card:not(.leave) img', is => is.every(i => i.complete && i.naturalWidth > 0));
        check('images of the last selected set load', allImgs);
        // keyboard
        await page.click('.g3d-dot[data-i="0"]'); await settle(page);
        await page.focus('.g3d-dot[data-i="0"]'); await page.keyboard.press('ArrowRight'); await settle(page);
        check('keyboard: ArrowRight on the dots moves to the next set', (await state(page)).count === `02 / ${pad(N)}`);
        await page.keyboard.press('ArrowLeft'); await settle(page);
        await page.focus('.g3d-card[data-p="3"]');
        const kf = await state(page);
        check('keyboard: focusing a poster shows its marker + info', kf.infoT === (ex.sets[0].posters[3].title || 'Poster 4') && kf.tipP === '3');
        await page.keyboard.press('Tab');
        check('keyboard: Tab from a poster goes to its "View larger"', await page.evaluate(() => document.activeElement.classList.contains('g3d-zoom')));
        // lightbox
        await page.keyboard.press('Enter');
        await page.waitForSelector('.g3d-lb.open');
        const lb1 = await page.evaluate(() => ({ cap: document.querySelector('.g3d-lb figcaption b').textContent, src: document.querySelector('.g3d-lb img').src,
          go: document.querySelector('.g3d-lb figcaption a').getAttribute('href'), focus: document.activeElement.className }));
        check('lightbox opens the poster large, with its info and an Explore link', lb1.cap === ex.sets[0].posters[3].title && /w=1200/.test(lb1.src)
          && decodeURIComponent(lb1.src).includes(ex.sets[0].posters[3].url) && lb1.go === '/product/' + encodeURIComponent(ex.sets[0].slug) && /g3d-lb-x/.test(lb1.focus), JSON.stringify(lb1));
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
        check('lightbox: → shows the next poster of the same set', (await page.textContent('.g3d-lb figcaption b')) === ex.sets[0].posters[4].title);
        await page.waitForFunction(() => { const i = document.querySelector('.g3d-lb img'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
        await page.screenshot({ path: path.join(ART, 'exhibition-lightbox.png') });
        await page.keyboard.press('Escape');
        check('lightbox: Escape closes it', !(await page.$('.g3d-lb.open')));
        // click a poster → product page
        await page.click('.g3d-card[data-p="0"]');
        await page.waitForSelector('.pinfo h1', { timeout: 15000 }).catch(() => {});
        check('clicking a poster opens its set\'s product page', page.url().endsWith('/product/' + ex.sets[0].slug)
          && (await page.innerText('.pinfo h1').catch(() => '')).trim() === (await (await fetch(base + '/api/products/' + ex.sets[0].slug)).json()).product.name);
      }
    }
    await ctx.close();
  }

  heading('Poster exhibition — reduced motion');
  const rctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  const r = await rctx.newPage(); T.watch(r, errors);
  await r.goto(base + '/', { waitUntil: 'networkidle' });
  await r.waitForSelector('.g3d-card img');
  const rm = await r.evaluate(() => ({ anim: [...document.querySelectorAll('.g3d-float')].map(e => getComputedStyle(e).animationName),
    op: [...document.querySelectorAll('.g3d-card')].map(e => getComputedStyle(e).opacity) }));
  check('no floating animation, posters fully visible', rm.anim.every(a => a === 'none') && rm.op.every(o => o === '1'), JSON.stringify(rm).slice(0, 100));
  await r.tap('.g3d-arrow[data-dir="1"]');
  const after = await r.evaluate(() => ({ n: document.querySelectorAll('.g3d-card').length, leave: document.querySelectorAll('.g3d-card.leave').length }));
  check('switching sets is instant (no leftover transition layers)', after.leave === 0 && after.n === ex.sets[1].posters.length, JSON.stringify(after));
  await rctx.close();

  heading('Admin → 🎨 Poster Exhibition');
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await actx.newPage(); T.watch(a, errors);
  a.on('dialog', d => d.accept());
  await a.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
  await a.waitForSelector('#u, #pane');
  if (await a.$('#u')) { await a.fill('#u', 'hssadmin'); await a.fill('#p', 'admin123'); await a.click('#lbtn'); }
  await a.waitForSelector('#pane');
  check('sidebar has its own "Poster Exhibition" item', (await a.innerText('.anav')).includes('Poster Exhibition'));
  await a.evaluate(() => window.GOTAB('exhibit'));
  await a.waitForSelector('.exrow');
  const rows = await a.$$eval('.exrow', rs => rs.length);
  check(`lists every set with posters (${rows})`, rows >= N);
  // move set 1 down, hide set 3, save
  await a.click('.exrow[data-i="0"] [data-mv="1"]');
  await a.click('.exrow[data-i="2"] [data-hide]');
  await a.click('#ex_save');
  await a.waitForFunction(() => /All changes saved/.test(document.getElementById('pane').innerText), null, { timeout: 8000 }).catch(() => {});
  let ex2 = await (await fetch(base + '/api/exhibition')).json();
  check('Admin order is used by the homepage (↓ moved set 1 to slot 2)', ex2.sets[0].id === ex.sets[1].id && ex2.sets[1].id === ex.sets[0].id);
  check('hidden set is left out (one dot fewer)', ex2.sets.length === N - 1 && !ex2.sets.some(x => x.id === ex.sets[2].id));
  const pubPage = await actx.newPage();
  await pubPage.goto(base + '/', { waitUntil: 'networkidle' }); await pubPage.waitForSelector('.g3d-card img');
  const ps = await state(pubPage);
  check('homepage shows the new first set and one dot fewer', ps.title === ex.sets[1].name && ps.dots === N - 1);
  // details: edit a description, save, see it; restore default
  await a.click('.exrow[data-i="0"] [data-open]');
  await a.waitForSelector('.exdet [data-px="0"]');
  await a.fill('.exdet [data-px="0"]', 'Admin wrote this exact line for the first poster in the exhibition.');
  await a.click('#ex_save');
  await a.waitForTimeout(800);
  ex2 = await (await fetch(base + '/api/exhibition')).json();
  check('Admin can edit and save a poster description', ex2.sets[0].posters[0].text.startsWith('Admin wrote this exact line'));
  await a.screenshot({ path: path.join(ART, 'exhibition-admin.png'), fullPage: false });
  await a.click('.exrow[data-i="0"] [data-open]').catch(() => {});
  await a.waitForSelector('.exdet [data-reset="0"]').catch(() => {});
  if (await a.$('.exdet [data-reset="0"]')) {
    await a.click('.exdet [data-reset="0"]'); await a.click('#ex_save'); await a.waitForTimeout(800);
    ex2 = await (await fetch(base + '/api/exhibition')).json();
    check('"Restore default" brings back the original description', ex2.sets[0].posters[0].text === ex.sets[1].posters[0].text);
  } else check('"Restore default" button available', false);
  // restore the original order / visibility for the rest of the suite
  await (await actx.request.post(base + '/api/admin/login', { data: { username: 'hssadmin', password: 'admin123' } })).json().then(async j => {
    await actx.request.put(base + '/api/admin/exhibition', { headers: { Authorization: 'Bearer ' + j.token }, data: { order: ex.sets.map(x => x.id), hidden: [] } });
  });
  check('restored original order', (await (await fetch(base + '/api/exhibition')).json()).sets.map(x => x.id).join() === ex.sets.map(x => x.id).join());
  await actx.close();

  check('no JS errors, console errors or failed requests (exhibition)', !errors.length, errors.slice(0, 4).join(' || '));
};
