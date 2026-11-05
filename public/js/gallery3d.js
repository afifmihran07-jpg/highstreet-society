/* HSS — 3D floating poster gallery (homepage, below the hero).
   Pure CSS 3D transforms; no libraries. Posters are the real catalogue
   artwork (product.posters from /api/products), shown through the existing
   /img resizer (a resized copy — the original artwork is never altered), and
   each poster links to its product page.
   Mount: HSSGallery3D.mount(sectionEl). Styles: .g3d* in /css/app.css. */
(function(){
const H = window.HSS;
if(!H) return;

/* Composition slots: x/y = % of the stage, z = depth (px), w = card width (px),
   ry/rz = resting rotation (deg), d = float duration (s). Front-to-back variety,
   nothing crossing the centre too aggressively. Far cards sit further out in
   x because perspective pulls distant objects towards the vanishing point. */
const DESKTOP = [
  { x:50, y:50, z:110,  w:196, ry:0,   rz:0,  d:7.0 },
  { x:31, y:44, z:10,   w:168, ry:14,  rz:-3, d:8.2 },
  { x:69, y:46, z:20,   w:168, ry:-14, rz:3,  d:7.6 },
  { x:11, y:60, z:-120, w:150, ry:22,  rz:-5, d:9.1 },
  { x:89, y:57, z:-110, w:150, ry:-22, rz:5,  d:8.7 },
  { x:36, y:22, z:-270, w:128, ry:8,   rz:2,  d:9.6 },
  { x:64, y:80, z:-210, w:132, ry:-8,  rz:-2, d:8.9 },
  { x:13, y:16, z:-350, w:118, ry:18,  rz:4,  d:10.2 },
  { x:87, y:18, z:-330, w:118, ry:-18, rz:-4, d:9.8 },
  { x:-5, y:34, z:-430, w:108, ry:26,  rz:6,  d:10.8 },
  { x:105,y:80, z:-410, w:108, ry:-26, rz:-6, d:10.4 }
];
const MOBILE = [
  { x:50, y:52, z:60,   w:126, ry:0,   rz:0,  d:8.0 },
  { x:16, y:40, z:-50,  w:100, ry:16,  rz:-4, d:9.0 },
  { x:84, y:42, z:-40,  w:100, ry:-16, rz:4,  d:8.6 },
  { x:26, y:86, z:-150, w:88,  ry:10,  rz:3,  d:9.6 },
  { x:74, y:13, z:-160, w:88,  ry:-10, rz:-3, d:9.4 },
  { x:-1, y:80, z:-230, w:80,  ry:22,  rz:5,  d:10.4 },
  { x:101,y:82, z:-220, w:80,  ry:-22, rz:-5, d:10.0 }
];

const mqMobile = matchMedia('(max-width:700px)');
const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
const mqFine = matchMedia('(hover:hover) and (pointer:fine)');

/* One distinct poster per set (rotating through each set's six artworks so
   neighbouring cards differ), falling back to the cover only if a set has no
   individual poster images. */
function pickPosters(products, n){
  const out = [];
  products.forEach((p, i) => {
    const arts = (p.posters || []).filter(Boolean);
    const url = arts.length ? arts[(i * 2) % arts.length] : p.cover;
    if(url && p.slug) out.push({ url, slug: p.slug, name: p.name || 'Poster set', setNo: p.setNo });
  });
  return out.slice(0, n);
}

function render(section, posters){
  const slots = (mqMobile.matches ? MOBILE : DESKTOP).slice(0, posters.length);
  const stage = section.querySelector('.g3d-stage');
  // tab order follows the visual left-to-right reading order
  const cards = slots.map((s, i) => ({ s, p: posters[i] })).sort((a, b) => a.s.x - b.s.x || a.s.y - b.s.y);
  const minZ = -450, maxZ = 120;
  stage.querySelector('.g3d-world').innerHTML = cards.map(({ s, p }, i) => {
    const depth = (s.z - minZ) / (maxZ - minZ);              // 0 = far … 1 = near
    const style = `--x:${s.x}%;--y:${s.y}%;--z:${s.z}px;--w:${s.w}px;--ry:${s.ry}deg;--rz:${s.rz}deg;` +
      `--dur:${s.d}s;--delay:${-(i * 1.37 % s.d).toFixed(2)}s;--i:${i};--lit:${(0.62 + depth * 0.38).toFixed(2)}`;
    return `<a class="g3d-card" href="/product/${encodeURIComponent(p.slug)}" style="${style}"
        aria-label="${H.esc(p.name)}${p.setNo ? ' (Set ' + H.esc(p.setNo) + ')' : ''}: view this poster set">
      <span class="g3d-float"><span class="g3d-inner">
        <img src="${H.esc(H.img(p.url, 400))}" alt="" width="400" height="566" loading="lazy" decoding="async">
        <span class="g3d-sheen" aria-hidden="true"></span>
      </span></span>
      <span class="g3d-label" aria-hidden="true">${H.esc(p.name)}</span>
    </a>`;
  }).join('');
  // a poster whose image fails is removed rather than shown broken
  stage.querySelectorAll('.g3d-card img').forEach(img => img.addEventListener('error', () => {
    const c = img.closest('.g3d-card'); if(c) c.remove();
    if(!stage.querySelector('.g3d-card')) section.remove();
  }, { once: true }));
}

function wireMotion(section){
  const stage = section.querySelector('.g3d-stage');
  const world = section.querySelector('.g3d-world');
  // entrance + pause animations while off-screen (saves CPU/battery)
  if('IntersectionObserver' in window){
    new IntersectionObserver(([e]) => {
      if(e.isIntersecting) section.classList.add('in');
      section.classList.toggle('paused', !e.isIntersecting);
    }, { threshold: 0.12 }).observe(section);
  } else section.classList.add('in');
  // desktop mouse parallax (fine pointers only, never with reduced motion)
  let raf = 0, tx = 0, ty = 0;
  const apply = () => { raf = 0; world.style.setProperty('--py', tx.toFixed(2) + 'deg'); world.style.setProperty('--px', ty.toFixed(2) + 'deg'); };
  stage.addEventListener('pointermove', e => {
    if(!mqFine.matches || mqReduce.matches || e.pointerType !== 'mouse') return;
    const r = stage.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 10;       // ±5° yaw
    ty = -((e.clientY - r.top) / r.height - 0.5) * 6;       // ±3° pitch
    if(!raf) raf = requestAnimationFrame(apply);
  });
  stage.addEventListener('pointerleave', () => { tx = ty = 0; if(!raf) raf = requestAnimationFrame(apply); });
}

async function mount(section){
  if(!section) return;
  try{
    const d = await H.api('/api/products?limit=24&sort=featured');
    const posters = pickPosters(d.items || [], DESKTOP.length);
    if(posters.length < 4){ section.remove(); return; }       // not enough real artwork: no gallery
    render(section, posters);
    wireMotion(section);
    let wasMobile = mqMobile.matches;
    mqMobile.addEventListener('change', () => { if(mqMobile.matches !== wasMobile){ wasMobile = mqMobile.matches; render(section, posters); } });
  }catch(e){ section.remove(); }
}

window.HSSGallery3D = { mount, pickPosters };
})();
