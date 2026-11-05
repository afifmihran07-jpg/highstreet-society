/* HSS homepage — editorial collage hero (mobile-first).
   Every piece of copy comes from Admin → Homepage; the defaults below are only
   used for fields the admin left empty and describe the poster-only business. */
(async function(){
const H = HSS;
// Section headings share one system: UPPERCASE with the last word accented.
// Works on admin-editable titles too, so the system survives content edits.
const hl = t => {
  const w = String(t || '').trim().toUpperCase().split(/\s+/);
  if (w.length < 2) return H.esc(w.join(' '));
  const last = w.pop();
  return H.esc(w.join(' ')) + ' <span class="l">' + H.esc(last) + '</span>';
};
const DEF = {
  line1: 'SIX POSTERS.', line2: 'ONE VIBE.', line3: 'YOUR', line3Italic: 'walls.',
  subtitle: 'Premium A4 poster sets on 3mm board: six matching designs, ready to hang. Delivered all over Bangladesh.',
  tagline: 'A4 • 3MM BOARD • 6 POSTERS PER SET',
  strip: 'PREMIUM A4 POSTER SETS • 3MM BOARD',
  marquee: ['NEW SETS EVERY DROP', 'NATIONWIDE DELIVERY', '6 POSTERS PER SET', 'CASH ON DELIVERY'],
  sections: {
    new: { title: 'New arrivals', sub: 'The latest poster sets, just dropped.' },
    best: { title: 'Cult favourites', sub: 'The sets everyone is hanging right now.' },
    collections: { title: 'Shop by vibe', sub: 'Find the wall aesthetic that feels like you.' },
    featured: { title: 'Featured sets', sub: 'Hand-picked by the HSS crew.' }
  },
  perks: [
    { title: 'Six posters, one set', text: 'Six matching A4 designs, curated to hang together.' },
    { title: '3mm premium board', text: 'Thick, rigid and durable. No frames needed.' },
    { title: 'Delivered all over BD', text: 'Every district and thana. Cash on delivery available.' },
    { title: 'Curated themed drops', text: 'Anime, football, Marvel, music, motorsport and more.' }
  ],
  insta: { title: 'Follow the society', text: 'New drops, room inspo & behind-the-scenes, first on Instagram.' }
};
const DEFAULT_HERO_IMG = '/images/hero-collage.png';
const el = document.getElementById('content');
try{
  const [d] = await Promise.all([ H.api('/api/homepage'), H.renderLayout('home') ]);
  const show = d.showSections||{};
  const hero = d.hero||{};
  const B = hero.blocks||{};
  const sec = k => { const x = (B.sections||{})[k] || {}; return { title: x.title || DEF.sections[k].title, sub: x.sub || DEF.sections[k].sub }; };
  const marquee = (B.marquee && B.marquee.length ? B.marquee : DEF.marquee);
  const perks = (B.perks && B.perks.length ? B.perks : DEF.perks);
  const insta = { title: (B.insta||{}).title || DEF.insta.title, text: (B.insta||{}).text || DEF.insta.text };
  const v = k => H.esc(hero[k] || DEF[k]);
  const img = hero.image && hero.image !== DEFAULT_HERO_IMG ? hero.image : '';
  const block = (k, cls, items, link) => { const s = sec(k); return `<div class="wrap"><section class="block">
    <div class="shead"><div><h2>${hl(s.title)}</h2>${s.sub?`<p>${H.esc(s.sub)}</p>`:''}</div>${link}</div>
    <div class="${cls}">${items}</div>
  </section></div>`; };

  el.innerHTML = `
  ${show.hero===false?'':`<section class="hero2">
    <div class="hero2-bg" aria-hidden="true"></div>
    <div class="wrap hero2-in">
      <div class="hero2-tx">
        ${hero.badge?`<span class="pill"><i></i>${H.esc(hero.badge)}</span>`:''}
        <h1>${v('line1')}<br>${v('line2')}<br>${v('line3')} <em>${v('line3Italic')}</em></h1>
        <p>${v('subtitle')}</p>
        <div class="hero2-kv">${v('tagline')}</div>
        <div class="cta">
          <a class="btn btn-lime" href="${H.esc(hero.ctaLink||'/shop')}">${H.esc(hero.ctaText||'Shop all sets')} &nbsp;→</a>
          <a class="btn btn-ghost" href="${H.esc(hero.cta2Link||'/shop?filter=new')}">${H.esc(hero.cta2Text||'New arrivals')} &nbsp;→</a>
        </div>
      </div>
      <div class="hero2-art">
        ${img ? `<img src="${H.esc(H.img(img,1200))}" alt="Highstreet Society poster sets" fetchpriority="high" decoding="async" onerror="this.onerror=null;this.src='${H.esc(img)}'">`
        : `<picture>
          <source media="(max-width:700px)" srcset="/images/hero-collage-sm.webp" type="image/webp">
          <source srcset="/images/hero-collage.webp" type="image/webp">
          <img src="/images/hero-collage.png" alt="Highstreet Society poster sets collage"
               width="1400" height="952" fetchpriority="high" decoding="async">
        </picture>`}
      </div>
    </div>
    <div class="hero2-foot">${v('strip')}</div>
  </section>`}

  ${show.gallery===false?'':`<section class="g3d" id="g3d" aria-label="Poster exhibition"><div class="wrap">
    <div class="shead"><div><h2>THE POSTER <span class="l">EXHIBITION</span></h2><p>Real sets from the collection. Tap any poster to open its set.</p></div><a class="more" href="/shop">All sets →</a></div>
    <div class="g3d-stage"><div class="g3d-world"></div></div>
  </div></section>`}

  ${show.marquee===false?'':`<div class="marquee"><div class="track">${marquee.map(t=>`<span>${H.esc(t)} <b>✦</b></span>`).join('').repeat(Math.max(2, Math.ceil(16/marquee.length)))}</div></div>`}

  ${show.new===false||!d.newArrivals.length?'':block('new','rail',d.newArrivals.map(H.card).join(''),'<a class="more" href="/shop?filter=new">View all →</a>')}

  ${show.best===false||!d.bestsellers.length?'':block('best','grid cols-4',d.bestsellers.slice(0,4).map(H.card).join(''),'<a class="more" href="/shop?filter=best">View all →</a>')}

  ${show.collections===false||!d.collections.length?'':block('collections','cgrid',d.collections.map(c=>{
      // Use real poster artwork from that category instead of a flat gradient.
      const pool=[...(d.newArrivals||[]),...(d.bestsellers||[]),...(d.featured||[])];
      const hit=pool.find(p=>(p.categoryIds||[]).includes(c.id));
      // prefer a single poster (pure artwork) over the cover composite
      const art=c.image || (hit&&hit.posters&&hit.posters[0]) || (hit&&hit.cover) || '';
      return `<a class="ccard" href="/shop?cat=${encodeURIComponent(c.id)}">
        ${art?`<img src="${H.esc(H.img(art,600))}" alt="" loading="lazy" onerror="this.remove()">`:''}
        <div class="sh"></div><div class="tx"><h3>${H.esc(c.name)}</h3></div>
      </a>`;}).join(''),'<a class="more" href="/shop">All sets →</a>')}

  ${show.featured===false||!d.featured.length?'':block('featured','rail',d.featured.map(H.card).join(''),'<a class="more" href="/shop">Shop all →</a>')}

  ${show.perks===false?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>${hl(d.perksTitle||'WHY HIGHSTREET SOCIETY')}</h2></div></div>
    <div class="perks">${perks.map((p,i)=>`<div class="perk"><span class="n">${String(i+1).padStart(2,'0')}</span><h3>${H.esc(p.title)}</h3><p>${H.esc(p.text||'')}</p></div>`).join('')}</div>
  </section></div>`}

  ${show.insta===false?'':`<div class="wrap"><div class="insta">
    <h2>${hl(insta.title)}</h2>
    <p>${H.esc(insta.text)}</p>
    <div class="cbtns" style="justify-content:center;display:flex;flex-wrap:wrap">
      ${H.social('instagram','Follow on Instagram','btn-lime')}
      ${H.social('whatsapp','Chat on WhatsApp','btn-ghost')}
      <a class="btn btn-ghost" href="/shop">Shop all sets</a>
    </div>
  </div></div>`}
  `;
  // 3D poster gallery (public/js/gallery3d.js) fills its reserved stage after the page paints
  if(window.HSSGallery3D) HSSGallery3D.mount(document.getElementById('g3d'));
}catch(e){
  el.innerHTML = `<div class="wrap">${H.empty('😕','Could not load the store','Please check your connection and refresh.','<button class="btn btn-lime" onclick="location.reload()">Retry</button>')}</div>`;
}
})();
