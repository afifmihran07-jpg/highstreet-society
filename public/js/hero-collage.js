/* HSS — homepage hero: dynamic, art-directed poster collage.
   Source of truth: GET /api/hero-posters, which lists every poster of every
   PUBLISHED set (live catalogue) with a measured colour "tone". Nothing is
   hard-coded, so new sets join automatically, and unpublished or deleted sets drop out.

   Every visit:
   1. picks a MOOD: on a browser's FIRST visit a pink editorial collection
      (pink, light posters from 3+ sets); afterwards any mood the catalogue can
      fill (category, cinematic dark, pop, mono, warm, cool, sports, curated
      mix), avoiding the moods, posters and exact combinations of recent visits;
   2. picks 5-7 posters that fit the mood and harmonise with a seed poster
      (max per set), then art-directs them into a COMPACT CLUSTER: the strongest
      poster anchors, supports tuck under its edges, light/dark alternate, and
      the whole group is fitted and centred from the posters' real proportions;
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

/* ---- layouts: COMPACT CLUSTERS, designed relative to the central poster.
   Units: the anchor poster is 1 wide (about 1.41 tall); x/y are poster centres,
   s = width, r = rotation (deg), z = depth 1 (back) to 3 (front).
   Supports tuck under the anchor's edges (about 15-30 % overlap) so the group
   reads as one editorial collage. The whole cluster is then fitted to the
   stage from the posters' REAL proportions and rotations, and centred
   (see cluster()), so posters of any shape keep the same compact shape.
   Slot 0 is the anchor; later slots run round the anchor so consecutive
   ones are neighbours (the composer alternates light/dark along them). ---- */
const C = (x, y, s, r, z) => ({ x, y, s, r, z });
const WIDE = {   // desktop (> 860 px): 6-7 posters
  halo:    [C(0, 0, 1, -2, 3), C(-.68, -.36, .72, -5, 2), C(.70, -.44, .68, 4, 2), C(1.16, -.02, .52, 7, 1),
            C(.66, .44, .72, -3, 2), C(-.62, .48, .66, 4, 2), C(-1.14, .06, .54, -8, 1)],
  cascade: [C(.22, 0, 1, 2, 3), C(-.52, -.40, .74, -4, 2), C(.88, -.42, .62, 6, 2), C(.86, .48, .58, -5, 2),
            C(-.48, .50, .70, 3, 2), C(-1.0, .66, .46, 6, 1), C(-1.08, -.06, .58, -7, 1)],
  duet:    [C(-.30, -.04, .96, -3, 3), C(.42, .08, .90, 3, 3), C(1.0, -.20, .58, 6, 2), C(.96, .58, .50, -5, 2),
            C(-.80, .55, .52, 5, 2), C(-.92, -.26, .60, -6, 1)]
};
const NARROW = { // tablet + phones (<= 860 px): 5 posters, a tighter dedicated cluster
  halo:    [C(0, 0, 1, -2, 3), C(-.66, -.22, .74, -6, 2), C(.68, -.20, .72, 6, 2), C(.56, .50, .58, -4, 2), C(-.56, .52, .56, 4, 2)],
  fan:     [C(0, 0, 1, 0, 3), C(-.60, .06, .82, -6, 2), C(.60, .06, .82, 6, 2), C(1.06, .14, .64, 11, 1), C(-1.06, .14, .64, -11, 1)],
  duet:    [C(-.30, -.04, .96, -3, 3), C(.42, .08, .90, 3, 3), C(1.0, -.10, .60, 6, 2), C(-.80, .52, .52, 5, 2), C(-.92, -.28, .56, -6, 1)]
};

/* ---- moods: fit(tone, poster) → 0…1; a mood is only used when enough
   posters pass `min`. Tones come from the server; null until measured. ---- */
const clamp = x => Math.max(0, Math.min(1, x));
const SPORT = /foot|motor|sport|f1|formula|cricket|racing|basket|nba|ufc|tennis/i;
const MOODS = {
  // pastel/editorial pink: pink AND light (keeps deep reds out)
  // (after the first visit pink is one mood among many, not the permanent theme)
  pink:  { w: .6,  cap: 3, min: .55, fit: t => t ? clamp(t.pink * 1.9 * (t.l > .52 ? 1 : t.l > .42 ? .6 : .25)) : 0 },
  noir:  { w: 1,   cap: 3, min: .55, fit: t => t ? clamp(t.dark * 1.25 + (.42 - t.l) * .9 - Math.max(0, t.c - .3)) : 0 },
  pop:   { w: 1,   cap: 3, min: .3,  fit: t => t ? clamp((t.c - .1) * 3.3) : 0 },
  mono:  { w: .5,  cap: 3, min: .7,  fit: t => t ? clamp(1 - (t.c - .03) * 7) : 0 },
  warm:  { w: .6,  cap: 3, min: .5,  fit: t => t ? clamp(t.warm * Math.min(1, t.c * 4.5) * (t.pink > .3 ? .4 : 1)) : 0 },
  cool:  { w: .5,  cap: 3, min: .3,  fit: t => t && t.h != null && t.h >= 160 && t.h <= 290 ? clamp(t.hc * t.c * 5) : 0 },
  sport: { w: .8,  cap: 3, min: .5,  fit: (t, p) => p.sport ? 1 : 0 },
  mixed: { w: .9,  cap: 1, min: 0,   fit: () => .6 }
};
const CAT_W = .8;   // weight of each category mood (anime, football, music, motorsport, Marvel, TV ...)
const KEY = 'hss_hero_v2';
const mem = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
const remember = m => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {} };
const rnd = (() => { try { const a = new Uint32Array(1); return () => (crypto.getRandomValues(a), a[0] / 4294967296); } catch (e) { return Math.random; } })();
const pickWeighted = list => { let s = list.reduce((a, x) => a + x.w, 0) * rnd(); for (const x of list) if ((s -= x.w) <= 0) return x; return list[list.length - 1]; };

function compose(posters, cats, n, skipFirst){
  const recent = new Map();                          // url -> how recently shown (1 = last visit)
  (mem.r || []).forEach((urls, k) => urls.forEach(u => recent.has(u) || recent.set(u, k + 1)));
  posters.forEach(p => { p.sport = p.cats.some(c => SPORT.test(cats[c] || c)); });
  const first = !skipFirst && !(mem.r && mem.r.length);
  const moods = [];
  // pink-leaning categories, found from the measured tones (average pinkness), never hard-coded
  const pc = {};
  posters.forEach(p => p.t && p.cats.forEach(c => { const a = pc[c] || (pc[c] = [0, 0]); a[0] += p.t.pink; a[1]++; }));
  const pinkCats = Object.keys(pc).filter(c => pc[c][0] / pc[c][1] >= .3);
  if (first) {
    // FIRST VISIT: a pink editorial collection: posters pink AND fairly light, at least 3 sets mixed
    moods.push({ id: 'pink', w: 1, cap: Math.max(2, Math.ceil(n / 3)), min: .5, sets: 3,
      fit: (t, p) => t ? clamp(t.pink * 1.5 * (t.l > .45 ? 1 : .5) + (p.cats.some(c => pinkCats.includes(c)) ? .35 : 0) - (t.dark > .4 ? .3 : 0)) : 0 });
  } else {
    Object.entries(MOODS).forEach(([id, m]) => moods.push({ id, ...m }));
    Object.keys(cats).forEach(c => moods.push({ id: 'cat:' + c, w: CAT_W, pinkish: pinkCats.includes(c), cap: 3, min: .5, fit: (t, p) => p.cats.includes(c) ? 1 : 0 }));
  }
  const lastMoods = mem.m || [];
  const eligible = moods.map(m => {
    const pool = posters.map(p => ({ p, f: m.fit(p.t, p) })).filter(x => x.f >= m.min);
    const perSet = {}; pool.forEach(x => { perSet[x.p.id] = Math.min(m.cap, (perSet[x.p.id] || 0) + 1); });
    const room = Object.values(perSet).reduce((a, b) => a + b, 0), sets = Object.keys(perSet).length;
    const ok = room >= n && sets >= (m.sets || 1);
    return { ...m, pool, w: ok ? m.w * (lastMoods[0] === m.id ? 0 : lastMoods.includes(m.id) || (m.pinkish && lastMoods.includes('pink')) ? .35 : 1) : 0 };
  }).filter(m => m.w > 0);
  if (!eligible.length) return first ? compose(posters, cats, n, true) : null;
  const sigs = mem.s || [];
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const m = pickWeighted(eligible);
    // curated, not random: a seed poster sets the tone; the rest are ranked by
    // mood fit + closeness in lightness and hue to the seed, minus recent use
    const base = x => x.f * .5 + rnd() * .4 - (recent.has(x.p.u) ? .7 / recent.get(x.p.u) : 0);
    const seed = m.pool.map(x => ({ x, s: base(x) })).sort((a, b) => b.s - a.s)[0].x, st = seed.p.t;
    const harm = t => { if (!st || !t) return .5; let h = 1 - Math.min(1, Math.abs(t.l - st.l) * 1.8);
      if (st.c > .12 && t.c > .12 && st.h != null && t.h != null) { const dh = Math.abs(t.h - st.h) % 360; h -= Math.min(dh, 360 - dh) / 180 * .6; }
      return h; };
    const ranked = m.pool.map(x => ({ ...x, s: x === seed ? 9 : base(x) + harm(x.p.t) * .45 })).sort((a, b) => b.s - a.s);
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

/* ---- layout maths: fit the cluster as ONE shape. Each poster's rotated
   footprint is measured from its real aspect ratio; the cluster's bounding box
   is scaled as large as the stage allows (small margin) and centred. Relative
   spacing never changes, so the group stays compact on every screen and
   posters are never cropped or pushed off-stage. Output in % of the stage. ---- */
function cluster(slots, ars, W, Hh){
  const M = .025;
  const ext = slots.map((s, i) => { const h = s.s * ars[i], a = Math.abs(s.r) * Math.PI / 180;
    return { hw: (s.s * Math.cos(a) + h * Math.sin(a)) / 2, hh: (s.s * Math.sin(a) + h * Math.cos(a)) / 2 }; });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  slots.forEach((s, i) => { x0 = Math.min(x0, s.x - ext[i].hw); x1 = Math.max(x1, s.x + ext[i].hw);
    y0 = Math.min(y0, s.y - ext[i].hh); y1 = Math.max(y1, s.y + ext[i].hh); });
  const U = Math.min(W * (1 - 2 * M) / (x1 - x0), Hh * (1 - 2 * M) / (y1 - y0));
  const ox = W / 2 - (x0 + x1) / 2 * U, oy = Hh / 2 - (y0 + y1) / 2 * U;
  return slots.map((s, i) => { const w = s.s * U, h = w * ars[i], cx = ox + s.x * U, cy = oy + s.y * U;
    return { r: s.r, z: s.z, w: w / W * 100, h: h / Hh * 100, left: (cx - w / 2) / W * 100, top: (cy - h / 2) / Hh * 100 }; });
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
    // desktop gets the 6-7 poster clusters; tablet and phones their own 5-poster ones
    const lib = innerWidth > 860 ? WIDE : NARROW;
    const tplIds = Object.keys(lib).filter(k => k !== mem.t);
    const tpl = tplIds[Math.floor(rnd() * tplIds.length)];
    const n = Math.min(lib[tpl].length, posters.length);
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
      r: [items.map(x => x.p.u), ...(mem.r || [])].slice(0, 3), s: [c.sig, ...(mem.s || [])].slice(0, 8) });
    if (document.hidden) await new Promise(r => document.addEventListener('visibilitychange', r, { once: true }));
    build(stage, items, lib[tpl].slice(0, items.length), { mood: c.mood, tpl });
  }).catch(fail);
}

function build(stage, items, slots, info){
  const L = cluster(slots, items.map(x => x.im.naturalHeight / x.im.naturalWidth), stage.clientWidth, Math.max(1, stage.clientHeight));
  stage.dataset.mood = info.mood; stage.dataset.tpl = info.tpl;
  stage.innerHTML = items.map((x, i) => { const s = L[i];
    return `<a class="hc-p" href="/product/${encodeURIComponent(x.p.slug)}" tabindex="-1" data-u="${H.esc(x.p.u)}"
      style="left:${s.left.toFixed(2)}%;top:${s.top.toFixed(2)}%;width:${s.w.toFixed(2)}%;z-index:${s.z * 10 + 9 - i};--z:${s.z};--fd:${(7 + rnd() * 3.5).toFixed(2)}s;--fy:${(-4 - rnd() * 4).toFixed(1)}px;--fr:${((rnd() - .5) * 1.4).toFixed(2)}deg;transform:rotate(${s.r}deg)">
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
