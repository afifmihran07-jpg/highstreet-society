/* HSS homepage — editorial collage hero (mobile-first) */
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
const el = document.getElementById('content');
try{
  const [d] = await Promise.all([ H.api('/api/homepage'), H.renderLayout('home') ]);
  const show = d.showSections||{};
  const hero = d.hero||{};
  const l1 = H.esc(hero.line1 || 'WEAR THE');
  const l2 = H.esc(hero.line2 || 'CULTURE.');
  const l3 = H.esc(hero.line3 || 'LIVE');
  const l3i = H.esc(hero.line3Italic || 'the space.');

  el.innerHTML = `
  ${show.hero===false?'':`<section class="hero2">
    <div class="hero2-bg" aria-hidden="true"></div>
    <div class="wrap hero2-in">
      <div class="hero2-tx">
        ${hero.badge?`<span class="pill"><i></i>${H.esc(hero.badge)}</span>`:''}
        <h1>${l1}<br>${l2}<br>${l3} <em>${l3i}</em></h1>
        <p>${H.esc(hero.subtitle||'Contemporary pieces for the streets and your walls.')}</p>
        <div class="hero2-kv">QUALITY • COMFORT • CULTURE</div>
        <div class="cta">
          <a class="btn btn-lime" href="${H.esc(hero.ctaLink||'/shop')}">${H.esc(hero.ctaText||'Shop the Collection')} &nbsp;→</a>
          <a class="btn btn-ghost" href="${H.esc(hero.cta2Link||'/shop?filter=new')}">${H.esc(hero.cta2Text||'Explore Posters')} &nbsp;→</a>
        </div>
      </div>
      <div class="hero2-art">
        <picture>
          <source media="(max-width:700px)" srcset="/images/hero-collage-sm.webp" type="image/webp">
          <source srcset="/images/hero-collage.webp" type="image/webp">
          <img src="/images/hero-collage.png" alt="Highstreet Society poster sets collage"
               width="1400" height="952" fetchpriority="high" decoding="async">
        </picture>
      </div>
    </div>
    <div class="hero2-foot">PREMIUM A4 POSTER SETS • 3MM BOARD</div>
  </section>`}

  ${show.marquee===false?'':`<div class="marquee"><div class="track">${('<span>DROP 01 LIVE <b>✦</b></span><span>NATIONWIDE DELIVERY <b>✦</b></span><span>6 POSTERS PER SET <b>✦</b></span><span>CASH ON DELIVERY <b>✦</b></span>').repeat(4)}</div></div>`}

  ${show.new===false||!d.newArrivals.length?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>NEW <span class="l">ARRIVALS</span></h2><p>Fresh drops, straight from the streets.</p></div><a class="more" href="/shop?filter=new">View all →</a></div>
    <div class="rail">${d.newArrivals.map(H.card).join('')}</div>
  </section></div>`}

  ${show.best===false||!d.bestsellers.length?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>CULT <span class="l">FAVOURITES</span></h2><p>The sets everyone is hanging right now.</p></div><a class="more" href="/shop?filter=best">View all →</a></div>
    <div class="grid cols-4">${d.bestsellers.slice(0,4).map(H.card).join('')}</div>
  </section></div>`}

  ${show.collections===false||!d.collections.length?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>SHOP BY <span class="l">VIBE</span></h2><p>Find the aesthetic that feels like you.</p></div><a class="more" href="/shop">All sets →</a></div>
    <div class="cgrid">${d.collections.map(c=>{
      // Use real poster artwork from that category instead of a flat gradient.
      const pool=[...(d.newArrivals||[]),...(d.bestsellers||[]),...(d.featured||[])];
      const hit=pool.find(p=>(p.categoryIds||[]).includes(c.id));
      // prefer a single poster (pure artwork) over the cover composite
      const art=c.image || (hit&&hit.posters&&hit.posters[0]) || (hit&&hit.cover) || '';
      return `<a class="ccard" href="/shop?cat=${c.id}">
        ${art?`<img src="${H.esc(art)}" alt="" loading="lazy" onerror="this.remove()">`:''}
        <div class="sh"></div><div class="tx"><h3>${H.esc(c.name)}</h3></div>
      </a>`;}).join('')}</div>
  </section></div>`}

  ${show.featured===false||!d.featured.length?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>FEATURED <span class="l">SETS</span></h2><p>Hand-picked by the HSS crew.</p></div><a class="more" href="/shop">Shop all →</a></div>
    <div class="rail">${d.featured.map(H.card).join('')}</div>
  </section></div>`}

  ${show.perks===false?'':`<div class="wrap"><section class="block">
    <div class="shead"><div><h2>${hl(d.perksTitle||'WHY HIGHSTREET SOCIETY')}</h2></div></div>
    <div class="perks">
      <div class="perk"><span class="n">01</span><h3>Six posters, one set</h3><p>Six matching A4 designs, curated to hang together.</p></div>
      <div class="perk"><span class="n">02</span><h3>3mm premium board</h3><p>Thick, rigid and durable — no frames needed.</p></div>
      <div class="perk"><span class="n">03</span><h3>Delivered all over BD</h3><p>Every district and thana. Cash on delivery available.</p></div>
      <div class="perk"><span class="n">04</span><h3>Street-certified</h3><p>Born on the streets. Quality, comfort, culture.</p></div>
    </div>
  </section></div>`}

  ${show.insta===false?'':`<div class="wrap"><div class="insta">
    <h2>FOLLOW THE <span class="l">SOCIETY</span></h2>
    <p>New drops, room inspo & behind-the-scenes — first on Instagram.</p>
    <div class="cbtns" style="justify-content:center;display:flex;flex-wrap:wrap">
      ${H.social('instagram','Follow on Instagram','btn-lime')}
      ${H.social('whatsapp','Chat on WhatsApp','btn-ghost')}
      <a class="btn btn-ghost" href="/shop">Shop the Feed</a>
    </div>
  </div></div>`}
  `;
}catch(e){
  el.innerHTML = `<div class="wrap">${H.empty('😕','Could not load the store','Please check your connection and refresh.','<button class="btn btn-lime" onclick="location.reload()">Retry</button>')}</div>`;
}
})();
