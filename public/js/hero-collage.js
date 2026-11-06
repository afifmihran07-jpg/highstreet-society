/* HSS — homepage hero: dynamic, art-directed poster collage.
   Source of truth: GET /api/hero-posters, which lists every poster of every
   PUBLISHED set (live catalogue) with a measured colour "tone". Nothing is
   hard-coded, so new sets join automatically, and unpublished or deleted sets drop out.

   Every visit:
   1. picks a MOOD that the catalogue can fill (pink editorial, cinematic dark,
      pop colour, black & white, warm, cool, sports, one category, curated mix),
      avoiding the moods, posters and exact combinations of recent visits;
   2. picks ~8 posters that fit the mood (max per set), then art-directs them
      into a hand-tuned layout: the strongest poster takes the anchor slot,
      and light/dark posters alternate so neighbours contrast;
   3. preloads ONLY those images (400 px /img renditions), then plays the
      entrance: a soft light blooms, posters drop onto a neat stack one by one,
      and the stack blooms outward into the collage. Then a slow, subtle float.
   Artwork is shown whole (each frame takes the image's own aspect ratio) and
   never altered. prefers-reduced-motion → a plain fade, no float/parallax.
   If anything fails, the original static collage is shown instead.
   Styles: .hc* in /css/app.css. No libraries. */
(function(){
const H = window.HSS;
if(!H) return;

/* ---- layouts: centre x/y in % of the stage, width in % of stage width,
   rotation (deg), depth z (1 back … 3 front). Slot 0 is the anchor; later
   slots are listed so that consecutive ones are neighbours. ---- */
const S = (cx, cy, w, r, z) => ({ cx, cy, w, r, z });
const WIDE = {   // desktop / tablet stage (1.47–1.6 : 1); 7–8 posters
  anchor: [S(50,52,30,-2,3), S(25,30,24,-6,2), S(75,29,24,5,2), S(88,66,22,-5,1),
           S(68,74,23,-3,2), S(32,75,23,3,2), S(11,64,22,4,1), S(50,20,19,2,1)],
  cascade:[S(57,50,29,3,3), S(34,26,23,-3,2), S(12,30,21,-7,1), S(30,70,24,-4,2),
           S(9,74,19,5,1), S(46,79,19,2,2), S(84,70,24,-3,2), S(81,25,22,6,1)],
  fan:    [S(50,50,27,0,3), S(37,51,24,-7,2), S(63,51,24,7,2), S(24,55,23,-14,1),
           S(76,55,23,14,1), S(11,61,22,-21,1), S(89,61,22,21,1)],
  salon:  [S(42,52,28,-2,3), S(17,31,22,-5,2), S(14,74,20,4,1), S(66,27,23,4,2),
           S(88,35,20,-4,1), S(67,72,24,-3,2), S(89,76,19,5,1), S(40,18,17,2,1)]
};
const NARROW = { // phone stage, 1.75 : 1; 5–6 posters
  anchor: [S(50,52,27,-2,3), S(28,46,23,-8,2), S(72,46,23,8,2), S(10,58,20,-4,1), S(90,58,20,4,1)],
  fan:    [S(50,50,25,0,3), S(35,52,22,-9,2), S(65,52,22,9,2), S(20,57,21,-18,1), S(80,57,21,18,1)],
  salon:  [S(42,52,26,-3,3), S(17,46,22,-6,2), S(67,40,22,5,2), S(88,60,19,-4,1), S(66,79,16,3,1), S(9,74,14,6,1)]
};

/* ---- moods: fit(tone, poster) → 0…1; a mood is only used when enough
   posters pass `min`. Tones come from the server; null until measured. ---- */
const clamp = x => Math.max(0, Math.min(1, x));
const SPORT = /foot|motor|sport|f1|formula|cricket|racing|basket|nba|ufc|tennis/i;
const MOODS = {
  // pastel/editorial pink: pink AND light (keeps deep reds out)
  pink:  { w: 1.2, cap: 3, min: .55, fit: t => t ? clamp(t.pink * 1.9 * (t.l > .52 ? 1 : t.l > .42 ? .6 : .25)) : 0 },
  noir:  { w: 1,   cap: 3, min: .55, fit: t => t ? clamp(t.dark * 1.25 + (.42 - t.l) * .9 - Math.max(0, t.c - .3)) : 0 },
  pop:   { w: 1,   cap: 3, min: .3,  fit: t => t ? clamp((t.c - .1) * 3.3) : 0 },
  mono:  { w: .7,  cap: 3, min: .7,  fit: t => t ? clamp(1 - (t.c - .03) * 7) : 0 },
  warm:  { w: .8,  cap: 3, min: .5,  fit: t => t ? clamp(t.warm * Math.min(1, t.c * 4.5) * (t.pink > .3 ? .4 : 1)) : 0 },
  cool:  { w: .8,  cap: 3, min: .3,  fit: t => t && t.h != null && t.h >= 160 && t.h <= 290 ? clamp(t.hc * t.c * 5) : 0 },
  sport: { w: 1,   cap: 3, min: .5,  fit: (t, p) => p.sport ? 1 : 0 },
  mixed: { w: 1,   cap: 1, min: 0,   fit: () => .6 }
};
const KEY = 'hss_hero_v1';
const mem = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
const remember = m => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} };
const rnd = (() => { try { const a = new Uint32Array(1); return () => (crypto.getRandomValues(a), a[0] / 4294967296); } catch (e) { return Math.random; } })();
const pickWeighted = list => { let s = list.reduce((a, x) => a + x.w, 0) * rnd(); for (const x of list) if ((s -= x.w) <= 0) return x; return list[list.length - 1]; };

function compose(posters, cats, n){
  const recent = new Map();                          // url → how recently shown (1 = last visit)
  (mem.r || []).forEach((urls, k) => urls.forEach(u => recent.has(u) || recent.set(u, k + 1)));
  posters.forEach(p => { p.sport = p.cats.some(c => SPORT.test(cats[c] || c)); });
  const moods = Object.entries(MOODS).map(([id, m]) => ({ id, ...m }));
  Object.keys(cats).forEach(c => moods.push({ id: 'cat:' + c, w: .35, cap: 4, min: .5, fit: (t, p) => p.cats.includes(c) ? 1 : 0 }));
  const lastMoods = mem.m || [];
  const eligible = moods.map(m => {
    const pool = posters.map(p => ({ p, f: m.fit(p.t, p) })).filter(x => x.f >= m.min);
    const perSet = {}; pool.forEach(x => { perSet[x.p.id] = Math.min(m.cap, (perSet[x.p.id] || 0) + 1); });
    const room = Object.values(perSet).reduce((a, b) => a + b, 0);
    return { ...m, pool, w: room >= n ? m.w * (lastMoods[0] === m.id ? 0 : lastMoods.includes(m.id) ? .35 : 1) : 0 };
  }).filter(m => m.w > 0);
  if (!eligible.length) return null;
  const sigs = mem.s || [];
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const m = pickWeighted(eligible);
    const ranked = m.pool.map(x => ({ ...x, s: x.f * .6 + rnd() * .5 - (recent.has(x.p.u) ? .6 / recent.get(x.p.u) : 0) }))
      .sort((a, b) => b.s - a.s);
    const used = {}, pick = [], spare = [];
    for (const x of ranked) {
      if ((used[x.p.id] || 0) >= m.cap) { spare.push(x); continue; }
      if (pick.length < n) { pick.push(x); used[x.p.id] = (used[x.p.id] || 0) + 1; } else spare.push(x);
    }
    const sig = pick.map(x => x.p.u).sort().join('|');
    best = { mood: m.id, pick, spare: spare.slice(0, 4).map(x => x.p), sig };
    if (pick.length === n && !sigs.includes(sig)) break;
  }
  // art direction: the strongest poster anchors; the rest alternate light/dark
  const impact = x => x.f + (x.p.t ? x.p.t.c * .6 + Math.abs(x.p.t.l - .5) * .4 : 0) + rnd() * .25;
  const pk = best.pick.slice().sort((a, b) => impact(b) - impact(a));
  const anchor = pk.shift();
  const byL = pk.sort((a, b) => (a.p.t ? a.p.t.l : .5) - (b.p.t ? b.p.t.l : .5));
  const order = [anchor.p];
  for (let lo = 0, hi = byL.length - 1, k = 0; lo <= hi; k++) order.push((k % 2 ? byL[lo++] : byL[hi--]).p);
  best.posters = order;
  return best;
}

/* ---- layout maths: % positions → fit the stage (never cropped, never off-stage) ---- */
function place(slots, ars, R){
  let s = 1;
  slots.forEach((sl, i) => { const h = sl.w * ars[i] * R / 2; s = Math.min(s, (sl.cy - 1) / h, (99 - sl.cy) / h); });
  return slots.map((sl, i) => { const w = sl.w * s, h = w * ars[i] * R;
    return { ...sl, w, h, left: Math.max(.5, Math.min(99.5 - w, sl.cx - w / 2)), top: sl.cy - h / 2 }; });
}
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover:hover) and (pointer:fine)');
const loadImg = (src, hi) => new Promise(res => {
  const im = new Image(); im.decoding = 'async'; if (hi) im.fetchPriority = 'high';
  let done = false; const fin = ok => { if (!done) { done = true; res(ok ? im : null); } };
  im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => fin(im.naturalWidth > 0));
  im.onerror = () => fin(false);
  im.src = src;
  setTimeout(() => fin(im.complete && im.naturalWidth > 0), 8000);
});

function mount(art, dataPromise, fallback){
  if (!art) return;
  const stage = art.querySelector('.hc-stage');
  const fail = () => { art.classList.remove('hc'); art.innerHTML = fallback; };
  Promise.resolve(dataPromise).then(async d => {
    const posters = (d && d.posters || []).filter(p => p && p.u);
    const narrow = () => stage.clientWidth / Math.max(1, stage.clientHeight) > 1.68;
    const lib = narrow() ? NARROW : WIDE;
    const tplIds = Object.keys(lib).filter(k => k !== mem.t);
    const tpl = tplIds[Math.floor(rnd() * tplIds.length)];
    // each layout has its own ideal count; tablets drop the smallest back poster
    const n = Math.min(lib[tpl].length - (lib === WIDE && innerWidth <= 860 && lib[tpl].length > 7 ? 1 : 0), posters.length);
    if (n < 4) return fail();
    const c = compose(posters, d.cats || {}, n);
    if (!c || c.posters.length < 4) return fail();
    // preload only the chosen posters; replace any that fail with spares
    const chosen = c.posters.slice(0, n), spares = c.spare.slice();
    const loaded = await Promise.all(chosen.map((p, i) => loadImg(H.img(p.u, 400), i < 4).then(async im => {
      while (!im && spares.length) { p = spares.shift(); im = await loadImg(H.img(p.u, 400)); }
      return im ? { p, im } : null;
    })));
    const items = loaded.filter(Boolean);
    if (items.length < 4) return fail();
    remember({ m: [c.mood, ...(mem.m || [])].slice(0, 3), t: tpl,
      r: [items.map(x => x.p.u), ...(mem.r || [])].slice(0, 2), s: [c.sig, ...(mem.s || [])].slice(0, 8) });
    if (document.hidden) await new Promise(r => document.addEventListener('visibilitychange', r, { once: true }));
    build(stage, items, lib[tpl].slice(0, items.length), { mood: c.mood, tpl });
  }).catch(fail);
}

function build(stage, items, slots, info){
  const R = stage.clientWidth / Math.max(1, stage.clientHeight);
  const L = place(slots, items.map(x => x.im.naturalHeight / x.im.naturalWidth), R);
  stage.dataset.mood = info.mood; stage.dataset.tpl = info.tpl;
  stage.innerHTML = items.map((x, i) => { const s = L[i];
    return `<a class="hc-p" href="/product/${encodeURIComponent(x.p.slug)}" tabindex="-1" data-u="${H.esc(x.p.u)}"
      style="left:${s.left.toFixed(2)}%;top:${s.top.toFixed(2)}%;width:${s.w.toFixed(2)}%;z-index:${s.z * 10 + (i ? 0 : 5)};--z:${s.z};--fd:${(7 + rnd() * 3.5).toFixed(2)}s;--fy:${(-4 - rnd() * 4).toFixed(1)}px;--fr:${((rnd() - .5) * 1.4).toFixed(2)}deg;transform:rotate(${s.r}deg)">
      <span class="hc-f"></span></a>`; }).join('');
  const els = [...stage.querySelectorAll('.hc-p')];
  els.forEach((a, i) => { const im = items[i].im; im.alt = ''; im.width = im.naturalWidth; im.height = im.naturalHeight; a.firstElementChild.appendChild(im); });
  stage.classList.add('hc-in');
  const live = () => { stage.classList.add('hc-live'); if (mqFine.matches && !mqReduce.matches) parallax(stage); };
  if (mqReduce.matches || !els[0].animate) {
    els.forEach((a, i) => a.animate ? a.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: i * 60, easing: 'ease-out', fill: 'backwards' }) : 0);
    return setTimeout(live, els.length * 60 + 650);
  }
  // entrance: back posters land on the stack first, the anchor lands last on top;
  // then the stack blooms outward in a clockwise sweep
  const W = stage.clientWidth, Hh = stage.clientHeight, sx = W * .5, sy = Hh * .54;
  const arrival = L.map((s, i) => i).sort((a, b) => L[a].z - L[b].z || b - a);
  const departure = L.map((s, i) => i).sort((a, b) =>
    Math.atan2(L[a].top + L[a].h / 2 - 50, L[a].left + L[a].w / 2 - 50) - Math.atan2(L[b].top + L[b].h / 2 - 50, L[b].left + L[b].w / 2 - 50));
  const T0 = 260, STAG = 80, ARR = 540, HOLD = 140, DST = 52, DEP = 1100;
  const stackDone = T0 + (els.length - 1) * STAG + ARR + HOLD;
  let last = 0;
  els.forEach((a, i) => {
    const s = L[i];
    const dx = sx - (s.left + s.w / 2) / 100 * W, dy = sy - (s.top + s.h / 2) / 100 * Hh;
    // a loose pile: each print lands slightly askew so the stack's edges show
    const k = arrival.indexOf(i), side = k % 2 ? 1 : -1;
    const jx = side * (4 + rnd() * 14) * W / 700, jy = (rnd() - .5) * 14 * W / 700;
    const rs = i === 0 ? (rnd() - .5) * 4 : side * (5 + rnd() * 9), r0 = rs + side * (10 + rnd() * 14);
    const start = T0 + k * STAG, leave = stackDone + departure.indexOf(i) * DST, D = leave + DEP - start;
    last = Math.max(last, start + D);
    a.animate([
      { offset: 0, opacity: 0, filter: 'blur(10px)', transform: `translate(${dx}px,${dy + 90}px) scale(.6) rotate(${r0}deg)`, easing: 'cubic-bezier(.2,.75,.25,1)' },
      { offset: ARR / D, opacity: 1, filter: 'blur(0px)', transform: `translate(${dx + jx}px,${dy + jy}px) scale(.74) rotate(${rs}deg)` },
      { offset: (leave - start) / D, opacity: 1, filter: 'blur(0px)', transform: `translate(${dx + jx}px,${dy + jy}px) scale(.74) rotate(${rs}deg)`, easing: 'cubic-bezier(.16,1,.3,1)' },
      { offset: 1, opacity: 1, filter: 'blur(0px)', transform: `translate(0px,0px) scale(1) rotate(${s.r}deg)` }
    ], { duration: D, delay: start, fill: 'backwards' });
    setTimeout(() => a.classList.add('hc-shine'), leave + DEP * .55);
  });
  setTimeout(live, last + 50);
}

/* desktop only: posters drift a few pixels against the pointer, by depth */
function parallax(stage){
  const hero = stage.closest('.hero2') || stage;
  let raf = 0, px = 0, py = 0;
  hero.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    px = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / r.width));
    py = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / r.height));
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; stage.style.setProperty('--px', px.toFixed(3)); stage.style.setProperty('--py', py.toFixed(3)); });
  });
  hero.addEventListener('pointerleave', () => { stage.style.setProperty('--px', 0); stage.style.setProperty('--py', 0); });
}

window.HSSHeroCollage = { mount, compose, MOODS };
})();
