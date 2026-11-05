/* HSS — 3D poster exhibition (homepage, directly below the hero).
   One slide per product set, in the order saved in Admin → Poster Exhibition
   (GET /api/exhibition). Each slide floats that set's own poster artwork (never
   mixed, never duplicated), shown through the existing /img resizer — the
   original artwork is never altered.
   Poster info is revealed ON the poster: a small geometric marker draws itself
   at the poster's corner and the poster's title + description fade in beside it
   (hover/focus on desktop, tap on touch). Clicking a poster (desktop) or
   "Explore set" opens the set's product page; "View larger" opens the lightbox.
   Pure CSS 3D transforms; no libraries. Styles: .g3d* in /css/app.css. */
(function(){
const H = window.HSS;
if(!H) return;

/* Desktop/tablet composition for up to six posters: slot 0 is the hero poster
   (largest, closest); the rest fan out at different depths and angles with
   minimal overlap. Far slots sit wider in x because perspective pulls distant
   objects towards the vanishing point. */
const DESKTOP = [
  { x:41, y:50, z:120,  w:190, ry:6,   rz:0,  d:11.0 },
  { x:60, y:46, z:20,   w:160, ry:-10, rz:2,  d:12.6 },
  { x:23, y:44, z:-60,  w:140, ry:16,  rz:-3, d:13.4 },
  { x:78, y:48, z:-60,  w:140, ry:-16, rz:3,  d:12.1 },
  { x:7,  y:58, z:-180, w:120, ry:24,  rz:-5, d:14.2 },
  { x:93, y:60, z:-180, w:120, ry:-24, rz:5,  d:13.7 }
];
/* Mobile: 2 rows × 3 columns, widths in % of the stage so all six always fit
   side by side without overlapping touch targets; only subtle depth/rotation. */
const MOBILE = [
  { x:17.5, y:27, z:10,  w:'27%', ry:6,  rz:-2,  d:12.0 },
  { x:50,   y:26, z:18,  w:'27%', ry:0,  rz:1,   d:13.2 },
  { x:82.5, y:27, z:10,  w:'27%', ry:-6, rz:2,   d:12.6 },
  { x:17.5, y:74, z:0,   w:'27%', ry:7,  rz:1.5, d:13.8 },
  { x:50,   y:76, z:8,   w:'27%', ry:0,  rz:-1,  d:12.9 },
  { x:82.5, y:74, z:0,   w:'27%', ry:-7, rz:-1.5,d:14.1 }
];
const mqMobile = matchMedia('(max-width:700px)');
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover:hover) and (pointer:fine)');
const pad = n => String(n).padStart(2, '0');
/* The HSS marker: a short top bar, a diagonal slash beneath it, and a small
   tick at the top of the slash. Each stroke draws itself in sequence. */
const MARK = `<svg class="g3d-mark" viewBox="0 0 22 18" aria-hidden="true" focusable="false">
  <path class="m1" d="M2 2.5H12"/><path class="m2" d="M5 15.5L13 7.5"/><path class="m3" d="M13 7.5H19"/></svg>`;

function mount(section){
  if(!section) return;
  H.api('/api/exhibition').then(d => {
    const sets = (d && d.enabled && d.sets || []).filter(s => s.posters && s.posters.length);
    if(!sets.length){ section.remove(); return; }
    build(section, sets);
  }).catch(() => section.remove());
}

function build(section, sets){
  const S = { sets, i: 0, sel: -1 };
  const stage = section.querySelector('.g3d-stage');
  const world = section.querySelector('.g3d-world');
  // the on-poster reveal lives in the stage (outside the 3D layer → crisp text)
  stage.insertAdjacentHTML('beforeend', `<div class="g3d-tip" role="group" aria-label="Poster details">${MARK}
    <div class="g3d-tip-tx"><span class="g3d-pn"></span><b></b><p></p>
      <div class="g3d-tip-act"><button type="button" class="g3d-zoom">View larger</button><a class="g3d-go" href="#">Explore set →</a></div></div></div>`);
  stage.insertAdjacentHTML('afterend', `
    <div class="g3d-cap" aria-live="polite"><span class="g3d-cap-hint">${MARK}Tap a poster for its story</span></div>
    <div class="g3d-nav">
      <div class="g3d-meta"><b class="g3d-title"></b><span class="g3d-count"></span></div>
      <div class="g3d-ctrl">
        <button type="button" class="g3d-arrow" data-dir="-1" aria-label="Previous set">‹</button>
        <div class="g3d-dots" role="group" aria-label="Choose a poster set">${sets.map((s, i) =>
          `<button type="button" class="g3d-dot" data-i="${i}" aria-label="Set ${i + 1} of ${sets.length}: ${H.esc(s.name)}"><i></i></button>`).join('')}</div>
        <button type="button" class="g3d-arrow" data-dir="1" aria-label="Next set">›</button>
      </div>
      <div class="g3d-links"><a class="g3d-cta" href="#">Explore this set →</a><a class="g3d-all" href="/shop">View all sets</a></div>
      <span class="g3d-sr" aria-live="polite"></span>
    </div>`);
  const tip = stage.querySelector('.g3d-tip');
  const cap = section.querySelector('.g3d-cap');
  /* Touch screens (phones, and tablets used by touch) show the reveal in a small
     caption area BELOW the six posters, so it never covers a neighbouring print;
     a tiny marker on the selected poster ties the caption to it. With a mouse the
     reveal stays on the poster itself. */
  const captionMode = () => mqMobile.matches || !mqFine.matches;
  function applyMode(){
    const on = captionMode();
    section.classList.toggle('capmode', on);
    if(on && tip.parentNode !== cap) cap.appendChild(tip);
    if(!on && tip.parentNode !== stage) stage.appendChild(tip);
    tip.style.transform = ''; tip.style.width = '';
  }
  applyMode();

  /* Keep the floating WhatsApp button (.wafab, from store.js) off the caption:
     while the caption is open on a touch layout and the button would overlap it,
     the button glides up to sit just above the caption; it glides back when the
     caption closes or scrolls clear. Uses the CSS `translate` property so the
     button's own transform effects (press scale, sticky-bar lift) still work. */
  let waRaf = 0;
  function waAvoid(){
    waRaf = 0;
    const wa = document.getElementById('wafab');
    if(!wa) return;
    const box = cap.classList.contains('has') && captionMode() && tip.classList.contains('on') ? tip.getBoundingClientRect() : null;
    if(!box){ wa.style.translate = ''; return; }
    // resting position from the CSS (not the on-screen rect, which may be mid-glide)
    const r = wa.getBoundingClientRect();
    const bottom = innerHeight - (parseFloat(getComputedStyle(wa).bottom) || 0), top = bottom - wa.offsetHeight, gap = 10;
    const overlaps = bottom > box.top - gap && top < box.bottom + gap && r.right > box.left && r.left < box.right;
    const lift = overlaps ? Math.min(0, box.top - gap - bottom) : 0;
    // never push the button off the top of the screen; if there is no room above, leave it in place
    wa.style.translate = lift && top + lift >= 8 ? `0 ${Math.round(lift)}px` : '';
  }
  let waSettle = 0;
  // run on the next frame, and once more after (smooth/momentum) scrolling settles
  const waQueue = () => { if(!waRaf) waRaf = requestAnimationFrame(waAvoid); clearTimeout(waSettle); waSettle = setTimeout(waAvoid, 180); };
  addEventListener('scroll', waQueue, { passive: true });
  addEventListener('resize', waQueue);
  document.body.classList.add('g3d-wa');  const live = section.querySelector('.g3d-sr');
  const touch = () => !mqFine.matches;
  const cards = () => [...world.querySelectorAll('.g3d-card:not(.leave)')];

  function cardsHtml(set){
    const slots = mqMobile.matches ? MOBILE : DESKTOP;
    const n = set.posters.length;
    return set.posters.map((p, i) => ({ p, i, s: slots[i % slots.length] }))
      // tab order follows what the eye reads: rows, then left → right
      .sort((a, b) => mqMobile.matches ? (a.s.y > 50) - (b.s.y > 50) || a.s.x - b.s.x : a.s.x - b.s.x)
      .map(({ p, i, s }, k) => {
        const depth = (s.z + 200) / 320;
        const w = typeof s.w === 'string' ? s.w : s.w + 'px';
        const style = `--x:${s.x}%;--y:${s.y}%;--z:${s.z}px;--w:${w};--ry:${s.ry}deg;--rz:${s.rz}deg;` +
          `--dur:${s.d}s;--delay:${-((i * 2.3) % s.d).toFixed(2)}s;--i:${k};--sway:${(i % 2 ? -1 : 1) * (2 + (i % 3))}deg;` +
          `--lit:${Math.min(1, 0.72 + depth * 0.28).toFixed(2)}`;
        const name = p.title || `Poster ${i + 1}`;
        return `<a class="g3d-card pre" href="/product/${encodeURIComponent(set.slug)}" data-p="${i}" style="${style}"
            aria-label="${H.esc(name)}${p.text ? '. ' + H.esc(p.text) : ''} Poster ${i + 1} of ${n} in ${H.esc(set.name)}. Open the set">
          <span class="g3d-float"><span class="g3d-inner">
            <img src="${H.esc(H.img(p.url, 400))}" alt="" width="400" height="566" decoding="async" ${i === 0 ? 'fetchpriority="high"' : ''}>
            <span class="g3d-sheen" aria-hidden="true"></span>
          </span></span>
        </a>`;
      }).join('');
  }

  /* ---------- on-poster reveal ---------- */
  let tipCard = null, follow = 0, hideT = 0;
  function placeTip(){
    if(!tipCard || !tipCard.isConnected){ hideTip(true); return; }
    if(captionMode()) return;                          // caption sits in normal flow below the stage
    const r = tipCard.querySelector('.g3d-inner').getBoundingClientRect(), s = stage.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    // marker + text sit on the lower part of the print and hang just below its edge,
    // so the artwork itself stays visible
    let left = r.left - s.left + 8, top = r.top - s.top + r.height * (mqMobile.matches ? 0.78 : 0.66);
    left = Math.max(8, Math.min(s.width - w - 8, left));
    top = Math.max(8, Math.min(s.height - h - 8, top));
    tip.style.transform = `translate3d(${left.toFixed(1)}px,${top.toFixed(1)}px,0)`;
    follow = requestAnimationFrame(placeTip);          // follow the floating poster
  }
  function showTip(card){
    clearTimeout(hideT);
    const set = S.sets[S.i], pi = +card.dataset.p, p = set.posters[pi];
    if(!p) return;
    const changed = tipCard !== card;
    tipCard = card; S.sel = pi;
    cards().forEach(c => c.classList.toggle('sel', c === card));
    if(changed){
      tip.querySelector('.g3d-pn').textContent = `${pad(pi + 1)} / ${pad(set.posters.length)}`;
      tip.querySelector('b').textContent = p.title || `Poster ${pi + 1}`;
      tip.querySelector('p').textContent = p.text || `One of the ${set.posters.length} A4 posters in ${set.name}.`;
      tip.querySelector('.g3d-go').href = '/product/' + encodeURIComponent(set.slug);
      tip.dataset.p = pi;
      // replay the marker + text reveal for the newly selected poster
      tip.classList.remove('on'); void tip.offsetWidth;
      tip.style.width = captionMode() ? '' : Math.round(Math.max(150, Math.min(196, card.getBoundingClientRect().width * 0.95))) + 'px';
    }
    tip.classList.add('on'); cap.classList.add('has'); waQueue();
    cancelAnimationFrame(follow); placeTip();
  }
  function hideTip(now){
    clearTimeout(hideT);
    const go = () => { tip.classList.remove('on'); cap.classList.remove('has'); waQueue(); cancelAnimationFrame(follow); tipCard = null; S.sel = -1; cards().forEach(c => c.classList.remove('sel')); };
    if(now) go(); else hideT = setTimeout(go, 140);
  }
  tip.addEventListener('mouseenter', () => clearTimeout(hideT));
  tip.addEventListener('mouseleave', e => { if(!(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.g3d-card'))) hideTip(); });
  tip.querySelector('.g3d-zoom').onclick = () => openLightbox(S.sel < 0 ? 0 : S.sel);
  // keyboard flow: poster → its "View larger" / "Explore set" → next poster
  tip.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ const c = tipCard; hideTip(true); if(c) c.focus(); return; }
    if(e.key !== 'Tab') return;
    const first = tip.querySelector('.g3d-zoom'), last = tip.querySelector('.g3d-go'), list = cards();
    const idx = list.indexOf(tipCard);
    if(e.shiftKey && document.activeElement === first && tipCard){ e.preventDefault(); tipCard.focus(); }
    else if(!e.shiftKey && document.activeElement === last){
      e.preventDefault();
      const next = list[idx + 1];
      if(next) next.focus(); else { hideTip(true); section.querySelector('.g3d-arrow').focus(); }
    }
  });
  section.addEventListener('focusout', () => setTimeout(() => {
    const a = document.activeElement;
    if(!(a && (tip.contains(a) || (a.closest && a.closest('.g3d-card')))) && !(touch() && tipCard) && !lbOpen()) hideTip(true);
  }, 0));

  function wireCards(){
    cards().forEach(c => {
      c.addEventListener('mouseenter', () => { if(!touch()) showTip(c); });
      c.addEventListener('mouseleave', e => { if(!touch() && !(e.relatedTarget && tip.contains(e.relatedTarget))) hideTip(); });
      c.addEventListener('focus', () => showTip(c));
      c.addEventListener('keydown', e => {
        if(e.key === 'Tab' && !e.shiftKey && tip.classList.contains('on') && tipCard === c){ e.preventDefault(); tip.querySelector('.g3d-zoom').focus(); }
      });
      c.addEventListener('click', e => {
        // touch: a tap selects the poster and reveals its info; "Explore set" navigates
        if(touch()){ e.preventDefault(); showTip(c); }
      });
      c.querySelector('img').addEventListener('error', () => { if(tipCard === c) hideTip(true); c.remove(); }, { once: true });
    });
  }
  /* Touch: a selected print steps forward in 3D, and the browser may then
     report the synthetic click on the stage instead of the print. Resolve the
     print under the finger by position; only a tap on empty space closes. */
  stage.addEventListener('click', e => {
    if(!touch() || e.target.closest('.g3d-card') || tip.contains(e.target)) return;
    const hit = document.elementsFromPoint(e.clientX, e.clientY).map(el => el.closest && el.closest('.g3d-card:not(.leave)')).find(Boolean);
    if(hit) showTip(hit); else hideTip(true);
  });

  function updateNav(){
    const set = S.sets[S.i];
    section.querySelector('.g3d-count').textContent = `${pad(S.i + 1)} / ${pad(S.sets.length)}`;
    const t = section.querySelector('.g3d-title');
    t.textContent = set.name;
    t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
    live.textContent = `Set ${S.i + 1} of ${S.sets.length}: ${set.name}`;
    const cta = section.querySelector('.g3d-cta');
    cta.href = '/product/' + encodeURIComponent(set.slug);
    cta.setAttribute('aria-label', 'Explore the ' + set.name + ' set');
    section.querySelectorAll('.g3d-dot').forEach((b, i) => {
      b.classList.toggle('on', i === S.i);
      if(i === S.i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const on = section.querySelector('.g3d-dot.on'), box = section.querySelector('.g3d-dots');
    if(on && box.scrollWidth > box.clientWidth) box.scrollLeft = on.offsetLeft - box.clientWidth / 2 + on.offsetWidth / 2;
  }

  function render(i, dir){
    hideTip(true);
    const old = [...world.querySelectorAll('.g3d-card')];
    S.i = (i + S.sets.length) % S.sets.length;
    old.forEach(c => { c.classList.add('leave'); c.style.setProperty('--dir', dir || 1); c.setAttribute('tabindex', '-1'); c.setAttribute('aria-hidden', 'true'); });
    if(mqReduce.matches) old.forEach(c => c.remove());            // reduced motion: switch instantly
    else setTimeout(() => old.forEach(c => c.remove()), 1000);
    world.insertAdjacentHTML('beforeend', cardsHtml(S.sets[S.i]));
    const fresh = [...world.querySelectorAll('.g3d-card.pre')];
    fresh.forEach(c => c.style.setProperty('--dir', dir || 1));
    wireCards();
    const reveal = () => fresh.forEach(c => c.classList.remove('pre'));
    if(mqReduce.matches) reveal(); else requestAnimationFrame(() => requestAnimationFrame(reveal));
    updateNav();
    preloadAround();
  }
  // lazy: only the active set renders; neighbours are fetched quietly afterwards
  const preloaded = new Set();
  function preloadAround(){
    const run = () => [1, -1].forEach(o => {
      const s = S.sets[(S.i + o + S.sets.length) % S.sets.length];
      if(preloaded.has(s.id)) return; preloaded.add(s.id);
      s.posters.forEach(p => { const im = new Image(); im.decoding = 'async'; im.src = H.img(p.url, 400); });
    });
    (window.requestIdleCallback || (f => setTimeout(f, 1200)))(run);
  }
  const go = d => render(S.i + d, d);

  section.querySelectorAll('.g3d-arrow').forEach(b => b.onclick = () => go(+b.dataset.dir));
  section.querySelectorAll('.g3d-dot').forEach(b => b.onclick = () => { const i = +b.dataset.i; if(i !== S.i) render(i, i > S.i ? 1 : -1); });
  section.querySelector('.g3d-ctrl').addEventListener('keydown', e => {
    if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1);
    const on = section.querySelector('.g3d-dot.on'); if(on && e.target.classList.contains('g3d-dot')) on.focus();
  });
  // swipe between sets on touch screens
  let sx = null;
  stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener('touchend', e => { if(sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if(Math.abs(dx) > 60) go(dx < 0 ? 1 : -1); }, { passive: true });

  /* ---------- lightbox: the set's artwork at full size, poster info, explore ---------- */
  let lb = null, lbi = 0, lastFocus = null;
  const lbOpen = () => !!(lb && lb.classList.contains('open'));
  function openLightbox(pi){
    lastFocus = tipCard || document.activeElement;
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
    hideTip(true);
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
    lb.querySelector('figcaption').innerHTML = `${MARK}<span class="g3d-pn">${H.esc(set.name)} · ${pad(lbi + 1)} / ${pad(n)}</span>
      <b>${H.esc(p.title || 'Poster ' + (lbi + 1))}</b><p>${H.esc(p.text || '')}</p>
      <a class="g3d-lb-go" href="/product/${encodeURIComponent(set.slug)}">Explore set →</a>`;
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
    tx = ((e.clientX - r.left) / r.width - 0.5) * 7;          // ±3.5° yaw
    ty = -((e.clientY - r.top) / r.height - 0.5) * 4;         // ±2° pitch
    if(!raf) raf = requestAnimationFrame(apply);
  });
  stage.addEventListener('pointerleave', () => { tx = ty = 0; if(!raf) raf = requestAnimationFrame(apply); });
  let wasMobile = mqMobile.matches;
  mqMobile.addEventListener('change', () => { applyMode(); if(mqMobile.matches !== wasMobile){ wasMobile = mqMobile.matches; render(S.i, 1); } });
  // input capability changed (e.g. a mouse plugged into a tablet): move the open reveal, don't close it
  mqFine.addEventListener('change', () => { applyMode(); if(tipCard){ cancelAnimationFrame(follow); placeTip(); } });

  render(0, 1);                       // the first set in the admin order opens by default
}

window.HSSGallery3D = { mount };
})();
