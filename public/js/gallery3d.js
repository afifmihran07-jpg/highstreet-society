/* HSS — 3D poster exhibition (homepage, directly below the hero).
   One slide per product set, in the order saved in Admin → Poster Exhibition
   (GET /api/exhibition). Each slide floats that set's own poster artwork (never
   mixed, never duplicated), shown through the existing /img resizer — the
   original artwork is never altered. Every poster has its own short info
   (hover/focus on desktop, tap on touch) and leads to the set's product page.
   Pure CSS 3D transforms; no libraries. Styles: .g3d* in /css/app.css. */
(function(){
const H = window.HSS;
if(!H) return;

/* Desktop/tablet composition for up to six posters: slot 0 is the hero poster
   (largest, closest); the rest fan out at different depths and angles with
   minimal overlap. Far slots sit wider in x because perspective pulls distant
   objects towards the vanishing point. */
const DESKTOP = [
  { x:41, y:50, z:120,  w:190, ry:6,   rz:0,  d:7.2 },
  { x:60, y:46, z:20,   w:160, ry:-10, rz:2,  d:8.1 },
  { x:23, y:44, z:-60,  w:140, ry:16,  rz:-3, d:8.8 },
  { x:78, y:48, z:-60,  w:140, ry:-16, rz:3,  d:8.4 },
  { x:7,  y:58, z:-180, w:120, ry:24,  rz:-5, d:9.6 },
  { x:93, y:60, z:-180, w:120, ry:-24, rz:5,  d:9.3 }
];
/* Mobile: 2 rows × 3 columns, widths in % of the stage so all six always fit
   side by side without overlapping touch targets; only subtle depth/rotation. */
const MOBILE = [
  { x:17.5, y:27, z:10,  w:'27%', ry:6,  rz:-2,  d:8.0 },
  { x:50,   y:26, z:18,  w:'27%', ry:0,  rz:1,   d:8.6 },
  { x:82.5, y:27, z:10,  w:'27%', ry:-6, rz:2,   d:8.3 },
  { x:17.5, y:74, z:0,   w:'27%', ry:7,  rz:1.5, d:9.0 },
  { x:50,   y:76, z:8,   w:'27%', ry:0,  rz:-1,  d:8.8 },
  { x:82.5, y:74, z:0,   w:'27%', ry:-7, rz:-1.5,d:9.2 }
];
const mqMobile = matchMedia('(max-width:700px)');
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover:hover) and (pointer:fine)');
const pad = n => String(n).padStart(2, '0');

function mount(section){
  if(!section) return;
  H.api('/api/exhibition').then(d => {
    const sets = (d && d.enabled && d.sets || []).filter(s => s.posters && s.posters.length);
    if(!sets.length){ section.remove(); return; }
    build(section, sets);
  }).catch(() => section.remove());
}

function build(section, sets){
  const S = { sets, i: 0, sel: 0, busy: false };
  const stage = section.querySelector('.g3d-stage');
  const world = section.querySelector('.g3d-world');
  stage.insertAdjacentHTML('afterend', `
    <div class="g3d-info" aria-live="polite"></div>
    <div class="g3d-nav">
      <div class="g3d-meta"><span class="g3d-count"></span><b class="g3d-title"></b></div>
      <div class="g3d-ctrl">
        <button type="button" class="g3d-arrow" data-dir="-1" aria-label="Previous set">‹</button>
        <div class="g3d-dots" role="group" aria-label="Choose a poster set">${sets.map((s, i) =>
          `<button type="button" class="g3d-dot" data-i="${i}" aria-label="Set ${i + 1} of ${sets.length}: ${H.esc(s.name)}"><i></i></button>`).join('')}</div>
        <button type="button" class="g3d-arrow" data-dir="1" aria-label="Next set">›</button>
      </div>
      <div class="g3d-links"><a class="g3d-cta" href="#">Explore this set →</a><a class="g3d-all" href="/shop">View all sets</a></div>
    </div>`);
  const info = section.querySelector('.g3d-info');
  const touch = () => !mqFine.matches;

  function cardsHtml(set){
    const slots = mqMobile.matches ? MOBILE : DESKTOP;
    const n = set.posters.length;
    return set.posters.map((p, i) => ({ p, i, s: slots[i % slots.length] }))
      // tab order follows what the eye reads: rows, then left → right
      .sort((a, b) => mqMobile.matches ? (a.s.y > 50) - (b.s.y > 50) || a.s.x - b.s.x : a.s.x - b.s.x)
      .map(({ p, i, s }) => {
        const depth = (s.z + 200) / 320;
        const w = typeof s.w === 'string' ? s.w : s.w + 'px';
        const style = `--x:${s.x}%;--y:${s.y}%;--z:${s.z}px;--w:${w};--ry:${s.ry}deg;--rz:${s.rz}deg;` +
          `--dur:${s.d}s;--delay:${-(i * 1.37 % s.d).toFixed(2)}s;--i:${i};--lit:${Math.min(1, 0.7 + depth * 0.3).toFixed(2)}`;
        const name = p.title || `Poster ${i + 1}`;
        return `<a class="g3d-card pre" href="/product/${encodeURIComponent(set.slug)}" data-p="${i}" style="${style}"
            aria-label="${H.esc(name)}, poster ${i + 1} of ${n} in ${H.esc(set.name)}. Open the set">
          <span class="g3d-float"><span class="g3d-inner">
            <img src="${H.esc(H.img(p.url, 400))}" alt="" width="400" height="566" decoding="async" ${i === 0 ? 'fetchpriority="high"' : ''}>
            <span class="g3d-sheen" aria-hidden="true"></span>
          </span></span>
        </a>`;
      }).join('');
  }

  function showInfo(pi){
    const set = S.sets[S.i], p = set.posters[pi];
    if(!p) return;
    S.sel = pi;
    world.querySelectorAll('.g3d-card').forEach(c => c.classList.toggle('sel', +c.dataset.p === pi && touch()));
    const title = p.title || `Poster ${pi + 1}`;
    const text = p.text || `One of ${set.posters.length} A4 posters in ${set.name}, printed on 3mm board.`;
    info.innerHTML = `<div class="g3d-info-tx"><span class="g3d-pn">Poster ${pi + 1} / ${set.posters.length}</span>
        <b>${H.esc(title)}</b><p>${H.esc(text)}</p></div>
      <div class="g3d-info-act"><button type="button" class="g3d-zoom">View larger</button>
        <a class="g3d-go" href="/product/${encodeURIComponent(set.slug)}">Explore set →</a></div>`;
    info.querySelector('.g3d-zoom').onclick = () => openLightbox(pi);
  }

  function updateNav(){
    const set = S.sets[S.i];
    section.querySelector('.g3d-count').textContent = `${pad(S.i + 1)} / ${pad(S.sets.length)}`;
    section.querySelector('.g3d-title').textContent = set.name;
    section.querySelector('.g3d-cta').href = '/product/' + encodeURIComponent(set.slug);
    section.querySelector('.g3d-cta').setAttribute('aria-label', 'Explore the ' + set.name + ' set');
    section.querySelectorAll('.g3d-dot').forEach((b, i) => {
      b.classList.toggle('on', i === S.i);
      if(i === S.i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const on = section.querySelector('.g3d-dot.on'), box = section.querySelector('.g3d-dots');
    if(on && box.scrollWidth > box.clientWidth) box.scrollLeft = on.offsetLeft - box.clientWidth / 2 + on.offsetWidth / 2;
  }

  function wireCards(){
    world.querySelectorAll('.g3d-card').forEach(c => {
      const pi = +c.dataset.p;
      c.addEventListener('mouseenter', () => { if(!touch()) showInfo(pi); });
      c.addEventListener('focus', () => showInfo(pi));
      c.addEventListener('click', e => {
        // touch: first tap selects + reveals info; "Explore set" navigates
        if(touch()){ e.preventDefault(); showInfo(pi); }
      });
      const img = c.querySelector('img');
      img.addEventListener('error', () => { c.remove(); }, { once: true });
    });
  }

  function render(i, dir){
    const old = [...world.querySelectorAll('.g3d-card')];
    S.i = (i + S.sets.length) % S.sets.length;
    old.forEach(c => { c.classList.add('leave'); c.style.setProperty('--dir', dir || 1); c.setAttribute('tabindex', '-1'); c.setAttribute('aria-hidden', 'true'); });
    setTimeout(() => old.forEach(c => c.remove()), mqReduce.matches ? 0 : 650);
    world.insertAdjacentHTML('beforeend', cardsHtml(S.sets[S.i]));
    const fresh = [...world.querySelectorAll('.g3d-card.pre')];
    wireCards();
    const reveal = () => fresh.forEach(c => c.classList.remove('pre'));
    if(mqReduce.matches) reveal(); else requestAnimationFrame(() => requestAnimationFrame(reveal));
    updateNav();
    showInfo(0);
    preloadAround();
  }
  // lazy: only the active set renders; neighbours are fetched quietly afterwards
  const preloaded = new Set();
  function preloadAround(){
    const go = () => [1, -1].forEach(o => {
      const s = S.sets[(S.i + o + S.sets.length) % S.sets.length];
      if(preloaded.has(s.id)) return; preloaded.add(s.id);
      s.posters.forEach(p => { const im = new Image(); im.decoding = 'async'; im.src = H.img(p.url, 400); });
    });
    (window.requestIdleCallback || (f => setTimeout(f, 1200)))(go);
  }
  const go = d => render(S.i + d, d);

  section.querySelectorAll('.g3d-arrow').forEach(b => b.onclick = () => go(+b.dataset.dir));
  section.querySelectorAll('.g3d-dot').forEach(b => b.onclick = () => { const i = +b.dataset.i; if(i !== S.i) render(i, i > S.i ? 1 : -1); });
  section.querySelector('.g3d-ctrl').addEventListener('keydown', e => {
    if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1);
    const on = section.querySelector('.g3d-dot.on'); if(on && e.target.classList.contains('g3d-dot')) on.focus();
  });
  // swipe between sets on touch screens (outside the posters' own taps)
  let sx = null;
  stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => { if(sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if(Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); }, { passive: true });

  /* ---------- lightbox: the set's artwork at full size, poster info, explore ---------- */
  let lb = null, lbi = 0, lastFocus = null;
  function openLightbox(pi){
    lastFocus = document.activeElement;
    if(!lb){
      lb = document.createElement('div');
      lb.className = 'g3d-lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Poster preview');
      lb.innerHTML = `<button type="button" class="g3d-lb-x" aria-label="Close">✕</button>
        <button type="button" class="g3d-lb-nav" data-d="-1" aria-label="Previous poster">‹</button>
        <figure><img alt=""><figcaption></figcaption></figure>
        <button type="button" class="g3d-lb-nav" data-d="1" aria-label="Next poster">›</button>`;
      document.body.appendChild(lb);
      lb.querySelector('.g3d-lb-x').onclick = closeLightbox;
      lb.querySelectorAll('.g3d-lb-nav').forEach(b => b.onclick = () => showLb(lbi + +b.dataset.d));
      lb.addEventListener('click', e => { if(e.target === lb) closeLightbox(); });
      lb.addEventListener('keydown', e => {
        if(e.key === 'Escape') closeLightbox();
        else if(e.key === 'ArrowRight') showLb(lbi + 1);
        else if(e.key === 'ArrowLeft') showLb(lbi - 1);
        else if(e.key === 'Tab'){                       // keep focus inside the dialog
          const f = [...lb.querySelectorAll('button,a[href]')]; const first = f[0], last = f[f.length - 1];
          if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
          else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
        }
      });
    }
    showLb(pi);
    lb.classList.add('open'); document.body.classList.add('g3d-lb-open');
    lb.querySelector('.g3d-lb-x').focus();
  }
  function showLb(pi){
    const set = S.sets[S.i], n = set.posters.length;
    lbi = (pi + n) % n;
    const p = set.posters[lbi];
    const img = lb.querySelector('img');
    img.src = H.img(p.url, 1200); img.alt = p.title || `Poster ${lbi + 1} of ${set.name}`;
    img.onerror = () => { img.onerror = null; img.src = p.url; };
    lb.querySelector('figcaption').innerHTML = `<span class="g3d-pn">${H.esc(set.name)} • Poster ${lbi + 1} / ${n}</span>
      <b>${H.esc(p.title || 'Poster ' + (lbi + 1))}</b><p>${H.esc(p.text || '')}</p>
      <a class="btn btn-lime" href="/product/${encodeURIComponent(set.slug)}">Explore set →</a>`;
    showInfo(lbi);
  }
  function closeLightbox(){
    lb.classList.remove('open'); document.body.classList.remove('g3d-lb-open');
    if(lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  /* ---------- motion: entrance, off-screen pause, desktop parallax ---------- */
  if('IntersectionObserver' in window){
    new IntersectionObserver(([e]) => {
      if(e.isIntersecting) section.classList.add('in');
      section.classList.toggle('paused', !e.isIntersecting);
    }, { threshold: 0.12 }).observe(section);
  } else section.classList.add('in');
  let raf = 0, tx = 0, ty = 0;
  const apply = () => { raf = 0; world.style.setProperty('--py', tx.toFixed(2) + 'deg'); world.style.setProperty('--px', ty.toFixed(2) + 'deg'); };
  stage.addEventListener('pointermove', e => {
    if(!mqFine.matches || mqReduce.matches || e.pointerType !== 'mouse') return;
    const r = stage.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 10;
    ty = -((e.clientY - r.top) / r.height - 0.5) * 6;
    if(!raf) raf = requestAnimationFrame(apply);
  });
  stage.addEventListener('pointerleave', () => { tx = ty = 0; if(!raf) raf = requestAnimationFrame(apply); });
  let wasMobile = mqMobile.matches;
  mqMobile.addEventListener('change', () => { if(mqMobile.matches !== wasMobile){ wasMobile = mqMobile.matches; render(S.i, 1); } });

  render(0, 1);                       // the first set in the admin order opens by default
}

window.HSSGallery3D = { mount };
})();
