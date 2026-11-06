/* HSS product detail page */
let LIMGS=[], LIDX=0;
function PLIGHT(d){ LIDX=(LIDX+d+LIMGS.length)%LIMGS.length;
  document.getElementById('lightimg').src=LIMGS[LIDX];
  document.getElementById('lightcount').textContent=(LIDX+1)+' / '+LIMGS.length; }
function POPEN(i){ LIDX=i; document.getElementById('lightimg').src=LIMGS[LIDX];
  document.getElementById('lightcount').textContent=(LIDX+1)+' / '+LIMGS.length;
  document.getElementById('light').classList.add('open'); }
document.addEventListener('keydown', e=>{
  if(!document.getElementById('light').classList.contains('open')) return;
  if(e.key==='Escape') document.getElementById('light').classList.remove('open');
  if(e.key==='ArrowRight') PLIGHT(1); if(e.key==='ArrowLeft') PLIGHT(-1);
});

(async function(){
await HSS.renderLayout('shop');
const H = HSS;
const slug = decodeURIComponent(location.pathname.split('/').pop());
const el = document.getElementById('content');
let P=null, qty=1, gidx=0, GIMGS=[];
try{
  const d = await H.api('/api/products/'+encodeURIComponent(slug));
  P = d.product;
  document.title = P.name + ' — Highstreet Society';
  document.querySelector('meta[name="description"]').setAttribute('content', (P.short||'') + (P.type==='poster'?' 6 premium A4 posters on 3mm board.':'') + ' COD all over Bangladesh.');
  const ld = document.createElement('script'); ld.type='application/ld+json';
  ld.textContent = JSON.stringify({ '@context':'https://schema.org','@type':'Product', name:P.name, image:P.cover,
    description:P.description, sku:P.sku, brand:{'@type':'Brand',name:'Highstreet Society'},
    offers:{'@type':'Offer', priceCurrency:'BDT', price:P.effPrice, availability:(P.stock>0||P.allowBackorder)?'https://schema.org/InStock':'https://schema.org/OutOfStock'} });
  document.head.appendChild(ld);
  fetch('/api/products/'+encodeURIComponent(P.slug)+'/view',{method:'POST'}).catch(()=>{});

  /* Gallery views. Poster sets open on the whole set (all six posters, uncropped),
     then each poster, then the branded cover last. Other product types keep the
     cover-first image list. The lightbox always shows the original images. */
  const ARTS = (P.posters||[]).filter(Boolean);
  const SETVIEW = (P.type||'poster')==='poster' && ARTS.length >= 2;
  const VIEWS = SETVIEW
    ? [{ k:'set' }, ...ARTS.map((u,i)=>({ k:'poster', u, n:i+1 })), ...(P.cover ? [{ k:'cover', u:P.cover }] : [])]
    : [P.cover, ...ARTS].filter(Boolean).map((u,i)=>({ k: i===0 ? 'cover' : 'poster', u, n:i }));
  GIMGS = VIEWS;
  LIMGS = VIEWS.filter(v=>v.u).map(v=>v.u);
  const lbIndex = i => SETVIEW ? i-1 : i;          // gallery index → lightbox index
  const viewLabel = v => v.k==='set' ? `All ${ARTS.length} posters` : v.k==='cover' ? 'Set cover' : `Poster ${v.n} / ${ARTS.length}`;
  const viewHtml = (v, first) => v.k==='set'
    ? `<div class="gset">${ARTS.map((u,i)=>`<button type="button" class="gsp" data-n="${i+1}" aria-label="View poster ${i+1}"><img src="${H.esc(H.img(u,400))}" alt="${H.esc(P.name)} — poster ${i+1}" ${first&&i<3?'fetchpriority="high"':'loading="lazy"'} decoding="async" width="400" height="566"></button>`).join('')}</div>`
    : `<img id="gimg" src="${H.esc(H.img(v.u,900))}" alt="${H.esc(P.name)} — ${H.esc(viewLabel(v))}" ${first?'fetchpriority="high"':''} onerror="this.onerror=null;this.src='${H.esc(v.u)}'">`;
  const out = !(P.stock>0||P.allowBackorder);
  const low = !out && P.stock<=5;
  const del = (H.settings && H.settings.delivery) || null;
  const cat = (await H.loadCats().catch(()=>[])).find(c=>(P.categoryIds||[]).includes(c.id));
  const promoLine = P.promo ? `<div class="promoline">${H.ico('sale')} ${H.esc(P.promo.name||'Sale')}${P.promo.endsAt?' • ends '+new Date(P.promo.endsAt).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):''}</div>` : '';

  el.innerHTML = `
  <div class="crumbs"><a href="/">Home</a> / <a href="/shop">Shop</a> / ${cat?`<a href="/shop?cat=${encodeURIComponent(cat.id)}">${H.esc(cat.name)}</a> / `:''}<span>${H.esc(P.name)}</span></div>
  <div class="pdp">
    <div class="gal">
      ${SETVIEW?`<div class="gtabs" role="group" aria-label="How to view this set">
        <button type="button" class="on" data-mode="gallery" aria-pressed="true">Posters</button>
        <button type="button" data-mode="wall" aria-pressed="false">See it on your wall</button></div>`:''}
      <div class="gmain${SETVIEW?' is-set':''}" id="gmain">
        <div class="gview" id="gview">${viewHtml(VIEWS[0], true)}</div>
        <span class="count" id="gcount">${H.esc(viewLabel(VIEWS[0]))}</span>
        <button class="gnav l" onclick="event.stopPropagation();GNAV(-1)" aria-label="Previous image">‹</button>
        <button class="gnav r" onclick="event.stopPropagation();GNAV(1)" aria-label="Next image">›</button>
      </div>
      <div class="gthumbs${SETVIEW?' with-set':''}" id="gthumbs">${VIEWS.map((v,i)=>`<button type="button" class="${i===0?'on':''}${v.k==='set'?' tset':''}" data-i="${i}" aria-label="${H.esc(viewLabel(v))}">${v.k==='set'
          ? `<span class="tgrid">${ARTS.slice(0,6).map(u=>`<img src="${H.esc(H.img(u,200))}" alt="" loading="lazy">`).join('')}</span>`
          : `<img src="${H.esc(H.img(v.u,200))}" alt="" loading="lazy" onerror="this.src='/images/logo-240.webp'">`}</button>`).join('')}</div>
      ${SETVIEW?`<div class="wallctl" id="wallctl" hidden>
        <div class="wrow"><span class="wlab">Layout</span><div class="seg" data-k="layout">
          <button type="button" data-v="grid" class="on">3 × 2</button><button type="button" data-v="row">Row of 6</button><button type="button" data-v="col">2 × 3</button></div></div>
        <div class="wrow"><span class="wlab">Wall</span><div class="swatches" data-k="tone">
          <button type="button" data-v="white" class="on" aria-label="Warm white wall"></button><button type="button" data-v="greige" aria-label="Greige wall"></button>
          <button type="button" data-v="sage" aria-label="Sage green wall"></button><button type="button" data-v="charcoal" aria-label="Charcoal wall"></button></div></div>
        <div class="wrow"><span class="wlab">View</span><div class="seg" data-k="zoom">
          <button type="button" data-v="room" class="on">Room</button><button type="button" data-v="close">Close-up</button></div>
          <label class="wtoggle"><input type="checkbox" id="w_sofa" checked> Sofa for scale</label></div>
        <p class="wnote" id="wnote"></p>
      </div>`:''}
      <div class="ghint">${P.type==='poster'?'1 set = 6 posters · tap to zoom':'Tap to zoom'}</div>
    </div>
    <div class="pinfo">
      <span class="setno">${P.type==='poster'?'SET '+H.esc(P.setNo||'--'):H.esc((P.type||'').toUpperCase())} ${P.isNew?'• NEW':''} ${P.bestseller?'• BESTSELLER':''}</span>
      <h1>${H.esc(P.name)}</h1>
      <p class="sub">${H.esc(P.short||'')}</p>
      <div class="pricerow"><span class="now">${H.money(P.effPrice)}</span>${P.effPrice<P.price?`<s>${H.money(P.price)}</s><span class="savechip">SAVE ${P.discountPct}%</span>`:''}</div>${promoLine}
      <div class="stockline"><span class="dot ${out?'out':low?'low':''}"></span>${out?'<span style="color:var(--danger)">Out of stock — restocking soon</span>':low?`<span style="color:var(--gold)">Only ${P.stock} set(s) left!</span>`:'<span style="color:var(--ok)">In stock, ready to ship</span>'}</div>
      ${P.type==='poster'?`<div class="specbox">
        <div><b>6</b><span>posters / set</span></div>
        <div><b>${H.esc(P.posterSize||'A4')}</b><span>size</span></div>
        <div><b>${H.esc(P.boardThickness||'3mm')}</b><span>board</span></div>
      </div>`:''}
      ${P.type==='combo'&&P.bundleItems&&P.bundleItems.length?`<div class="bundlebox">
        <h4>This bundle includes</h4>
        <ul>${P.bundleItems.map(x=>`<li>${H.esc(x)}</li>`).join('')}</ul>
      </div>`:''}
      ${P.sizes&&P.sizes.length?`<div class="sizebox">
        <div class="sizehead"><label>Select size *</label><span id="sizehint">Please choose a size</span></div>
        <div class="sizes" id="sizes">${P.sizes.map(x=>`<button type="button" class="sz${x.stock<=0?' out':''}" data-size="${H.esc(x.size)}" data-stock="${x.stock}" ${x.stock<=0?'disabled':''}>${H.esc(x.size)}${x.stock<=0?'<i>sold out</i>':''}</button>`).join('')}</div>
      </div>`:''}
      ${out?'':`<div class="buyrow" id="mainbuy">
        <div class="qty"><button onclick="PQTY(-1)">−</button><b id="pq">1</b><button onclick="PQTY(1)">+</button></div>
        <button class="btn btn-lime" onclick="PADD()">Add to Cart</button>
      </div>
      <div class="wishrow">
        <button class="btn btn-ghost" onclick="PBUY()">Buy Now</button>
        <button class="btn btn-quiet iconbtn${H.inWish(P.id)?' on':''}" onclick="HSS.toggleWish('${P.id}');this.classList.toggle('on');this.setAttribute('aria-pressed',this.classList.contains('on'))" aria-pressed="${H.inWish(P.id)?'true':'false'}" aria-label="Wishlist">${H.ico('heart')}<span>${H.inWish(P.id)?'Saved':'Wishlist'}</span></button>
      </div>`}
      ${out?`<div class="buyrow"><button class="btn btn-ghost btn-block" onclick="HSS.toggleWish('${P.id}')">${H.ico('heart')} Notify me — Save to wishlist</button></div>`:''}
      <div class="acc">
        <details open><summary>About this set</summary><div class="ab">${H.esc(P.description||'Premium 6-poster wall set.').replace(/\n/g,'<br>')}</div></details>
        <details><summary>Size & material</summary><div class="ab">${P.type==='poster'
  ? `• 6 different ${H.esc(P.posterSize||'A4')} posters (21 × 29.7 cm)<br>• Printed/mounted on rigid ${H.esc(P.boardThickness||'3mm')} premium board<br>• Ready to hang — no frames needed`
  : (P.sizes&&P.sizes.length ? '• Available sizes: '+P.sizes.map(x=>H.esc(x.size)).join(', ') : '• One size')}<br>• SKU: ${H.esc(P.sku||'—')}</div></details>
        <details><summary>Delivery & payment</summary><div class="ab">${del?`• Inside Dhaka: ${H.money(del.inside)} • Outside Dhaka: ${H.money(del.outside)}${del.freeAbove>0?` • Free delivery over ${H.money(del.freeAbove)}`:''}<br>`:''}• Cash on Delivery, bKash & Nagad accepted<br>• Track your order anytime with your Order ID + mobile number</div></details>
      </div>
      ${P.tags&&P.tags.length?`<div class="glabels" style="margin-top:14px">${P.tags.map(t=>`<a href="/shop?q=${encodeURIComponent(t)}"><span>#${H.esc(t)}</span></a>`).join('')}</div>`:''}
    </div>
  </div>
  ${d.related&&d.related.length?`<section class="block" style="padding-top:10px"><div class="shead"><div><h2>COMPLETE THE <span class="l">WALL</span></h2></div><a class="more" href="${cat?'/shop?cat='+encodeURIComponent(cat.id):'/shop'}">${cat?'More '+H.esc(cat.name)+' →':'All sets →'}</a></div><div class="rail">${d.related.map(H.card).join('')}</div></section>`:''}
  `;

  function wireSet(){
    document.querySelectorAll('#gview .gsp').forEach(b=>b.onclick=e=>{ e.stopPropagation(); GNAV(+b.dataset.n - gidx); });
  }
  window.GNAV = dd => {
    gidx=(gidx+dd+GIMGS.length)%GIMGS.length;
    const v=GIMGS[gidx], gv=document.getElementById('gview');
    gv.classList.remove('swap'); void gv.offsetWidth; gv.classList.add('swap');
    gv.innerHTML=viewHtml(v,false);
    document.getElementById('gmain').classList.toggle('is-set', v.k==='set');
    document.getElementById('gcount').textContent=viewLabel(v);
    document.querySelectorAll('#gthumbs button').forEach(b=>{ b.classList.toggle('on',+b.dataset.i===gidx); if(+b.dataset.i===gidx) b.setAttribute('aria-current','true'); else b.removeAttribute('aria-current'); });
    if(v.k==='set') wireSet();
  };
  wireSet();

  /* ---------- "See it on your wall": the six real posters at true A4 scale ----------
     A front view of a wall, drawn to scale: posters are 21 × 29.7 cm with 5 cm gaps,
     hung 22 cm above a 170 cm sofa (a common gallery-wall rule), or centred at eye
     height (150 cm) without it. Everything is measured in centimetres and converted
     with one scale factor, so sizes stay honest at every screen width. */
  const W = { mode:'gallery', layout:'grid', tone:'white', zoom:'room', sofa:true };
  const LAYOUT = { grid:{ c:3, r:2, n:'3 × 2 grid' }, row:{ c:6, r:1, n:'row of 6' }, col:{ c:2, r:3, n:'2 × 3 column' } };
  const A4W = 21, A4H = 29.7, GAP = 5, SOFA_W = 170, SOFA_H = 82, ABOVE = 22, EYE = 150;
  function wallHtml(){
    const L = LAYOUT[W.layout];
    return `<div class="wallscene tone-${W.tone}" id="wallscene">
      <div class="wl"></div><div class="wfloor"></div><div class="wskirt"></div>
      <div class="wset" style="grid-template-columns:repeat(${L.c},minmax(0,1fr));grid-template-rows:repeat(${L.r},minmax(0,1fr))">${ARTS.slice(0,6).map((u,i)=>`<button type="button" class="wp" data-n="${i+1}" aria-label="Poster ${i+1}: view it up close"><img src="${H.esc(H.img(u,400))}" alt="" decoding="async"></button>`).join('')}</div>
      ${W.sofa && W.zoom==='room'?'<div class="sofa" aria-hidden="true"><i class="sb"></i><i class="ss"></i><i class="sa l"></i><i class="sa r"></i><i class="sc l"></i><i class="sc r"></i><i class="sl l"></i><i class="sl r"></i></div>':''}
    </div>`;
  }
  function layoutWall(){
    const sc = document.getElementById('wallscene'); if(!sc) return;
    const L = LAYOUT[W.layout];
    const span = W.zoom === 'room' ? 240 : 140;                 // centimetres of wall across the view
    const cm = sc.clientWidth / span, H = sc.clientHeight, floor = H * 0.13;
    sc.style.setProperty('--cm', cm + 'px'); sc.style.setProperty('--floor', floor + 'px');
    const gw = L.c * A4W + (L.c - 1) * GAP, gh = L.r * A4H + (L.r - 1) * GAP;
    const set = sc.querySelector('.wset');
    set.style.width = gw * cm + 'px'; set.style.height = gh * cm + 'px';
    set.style.columnGap = set.style.rowGap = GAP * cm + 'px';
    if(W.zoom === 'close'){                                       // close-up: the set centred on the wall, no furniture
      set.style.bottom = Math.max(floor + 10 * cm, (H - gh * cm) / 2 + floor / 2) + 'px';
    } else {
      const bottomCm = W.sofa ? SOFA_H + ABOVE : Math.max(30, EYE - gh / 2);
      set.style.bottom = floor + bottomCm * cm + 'px';
    }
    const so = sc.querySelector('.sofa');
    if(so){ so.style.width = SOFA_W * cm + 'px'; so.style.height = SOFA_H * cm + 'px'; so.style.bottom = floor - 2 * cm + 'px'; }
    document.getElementById('wnote').textContent =
      `Shown to scale: ${L.n}, about ${Math.round(gw)} × ${Math.round(gh)} cm with 5 cm gaps. Each poster is A4 (21 × 29.7 cm)${W.sofa && W.zoom==='room'?'; the sofa is 170 cm wide for reference':''}.`;
  }
  function setMode(m){
    W.mode = m;
    document.querySelectorAll('.gtabs button').forEach(b=>{ const on=b.dataset.mode===m; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
    const gm=document.getElementById('gmain'), gv=document.getElementById('gview');
    gm.classList.toggle('is-wall', m==='wall');
    document.getElementById('wallctl').hidden = m!=='wall';
    document.getElementById('gthumbs').hidden = m==='wall';
    if(m==='wall'){ gv.innerHTML=wallHtml(); wireWall(); requestAnimationFrame(layoutWall); }
    else { gidx=0; GNAV(0); }
  }
  function wireWall(){
    document.querySelectorAll('#wallscene .wp').forEach(b=>b.onclick=e=>{ e.stopPropagation(); setMode('gallery'); GNAV(+b.dataset.n); });
  }
  if(SETVIEW){
    document.querySelectorAll('.gtabs button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
    document.querySelectorAll('#wallctl [data-k] button').forEach(b=>b.onclick=()=>{
      const k=b.parentNode.dataset.k; W[k]=b.dataset.v;
      b.parentNode.querySelectorAll('button').forEach(x=>{ x.classList.toggle('on',x===b); x.setAttribute('aria-pressed',x===b); });
      document.getElementById('gview').innerHTML=wallHtml(); wireWall(); layoutWall();
    });
    // the sofa only makes sense in the room view
    const syncSofa = () => { document.getElementById('w_sofa').parentNode.style.visibility = W.zoom==='room' ? '' : 'hidden'; };
    document.querySelectorAll('#wallctl [data-k=zoom] button').forEach(b=>b.addEventListener('click', syncSofa));
    document.getElementById('w_sofa').onchange=e=>{ W.sofa=e.target.checked; document.getElementById('gview').innerHTML=wallHtml(); wireWall(); layoutWall(); };
    addEventListener('resize', ()=>{ if(W.mode==='wall') layoutWall(); });
  }
  // a single image opens the full-size lightbox; the set view picks a poster instead
  document.getElementById('gmain').addEventListener('click', () => { if(W.mode==='gallery' && GIMGS[gidx].u) POPEN(lbIndex(gidx)); });
  document.querySelectorAll('#gthumbs button').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i; const diff=(i-gidx+GIMGS.length)%GIMGS.length; GNAV(diff); });
  // touch swipe
  let tx0=null;
  const gm=document.getElementById('gmain');
  gm.addEventListener('touchstart',e=>tx0=e.touches[0].clientX,{passive:true});
  gm.addEventListener('touchend',e=>{ if(tx0==null)return; const dx=e.changedTouches[0].clientX-tx0; if(Math.abs(dx)>40) GNAV(dx<0?1:-1); tx0=null; },{passive:true});
  window.PQTY = dd => { const max=Math.min(20, P.allowBackorder?20:Math.max(1,P.stock)); qty=Math.max(1,Math.min(max,qty+dd)); document.getElementById('pq').textContent=qty; };
  let chosenSize = null;
  if(P.sizes && P.sizes.length){
    document.querySelectorAll('#sizes .sz').forEach(b=>b.onclick=()=>{
      if(b.disabled) return;
      chosenSize=b.dataset.size;
      document.querySelectorAll('#sizes .sz').forEach(x=>x.classList.toggle('on',x===b));
      const st=+b.dataset.stock;
      const hint=document.getElementById('sizehint');
      hint.textContent = st<=5 ? `Only ${st} left in size ${chosenSize}` : `Size ${chosenSize} selected`;
      hint.className = st<=5 ? 'low' : 'ok';
    });
  }
  function needSize(){
    if(P.sizes && P.sizes.length && !chosenSize){
      H.toast('Please select a size first');
      const sb=document.getElementById('sizes');
      if(sb){ sb.classList.add('shake'); setTimeout(()=>sb.classList.remove('shake'),500);
        sb.scrollIntoView({behavior:'smooth',block:'center'}); }
      return true;
    }
    return false;
  }
  window.PADD = () => { if(needSize()) return; H.addToCart(P.id, qty, chosenSize); };
  window.PBUY = () => { if(needSize()) return; H.addToCart(P.id, qty, chosenSize); location.href='/checkout'; };

  /* Mobile: sticky buy bar once the main Add-to-cart buttons scroll away. */
  const mainBuy = document.getElementById('mainbuy');
  if(mainBuy && 'IntersectionObserver' in window){
    const bar = document.createElement('div');
    bar.className = 'stickybuy'; bar.setAttribute('aria-hidden','true');
    bar.innerHTML = `<div class="sb-p"><b>${H.money(P.effPrice)}</b>${P.effPrice<P.price?`<s>${H.money(P.price)}</s>`:''}<span>6 posters • ${H.esc(P.posterSize||'A4')}</span></div>
      <button class="btn btn-lime" onclick="PADD()">Add to cart</button>`;
    document.body.appendChild(bar);
    // sit exactly on top of the mobile tab bar (its height varies with safe-area insets)
    const place = () => { const tb = document.querySelector('.tabbar');
      bar.style.bottom = tb && getComputedStyle(tb).display !== 'none' ? tb.getBoundingClientRect().height + 'px' : '0px'; };
    place(); addEventListener('resize', place);
    new IntersectionObserver(([e])=>{
      const on = !e.isIntersecting && e.boundingClientRect.top < 0;
      bar.classList.toggle('on', on); bar.setAttribute('aria-hidden', on?'false':'true');
      document.body.classList.toggle('has-stickybuy', on);   // lifts the WhatsApp button above the bar
    }).observe(mainBuy);
  }

  /* ---------- reviews ---------- */
  const rv=document.createElement('div'); rv.className='wrap'; rv.id='rvsec';
  document.getElementById('content').appendChild(rv);
  async function loadReviews(){
    let d={reviews:[],count:0,average:0};
    try{ d=await H.api('/api/products/'+encodeURIComponent(P.slug)+'/reviews'); }catch(e){}
    const stars=n=>'<span class="stars">'+'★'.repeat(Math.round(n))+'☆'.repeat(5-Math.round(n))+'</span>';
    rv.innerHTML=`<section class="block"><div class="shead"><div>
      <h2>CUSTOMER <span class="l">REVIEWS</span></h2>
      <p>${d.count?`${stars(d.average)} ${d.average} out of 5 • ${d.count} review${d.count>1?'s':''}`:'Be the first to review this set.'}</p>
    </div><button type="button" class="btn btn-ghost btn-sm" id="rv_open" aria-expanded="false" aria-controls="rvform">Write a review</button></div>
    <div class="rvwrap rvclosed${d.reviews.length?'':' rvempty'}">
      <div class="rvlist">${d.reviews.length?d.reviews.map(r=>`<div class="rvitem">
        <div class="rvtop"><b>${H.esc(r.name)}</b>${stars(r.rating)}</div>
        <p>${H.esc(r.text)}</p>
        <span class="rvdate">${new Date(r.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
      </div>`).join(''):''}</div>
      <div class="panel rvform" id="rvform">
        <h2>Write a review</h2>
        <div class="fld"><span class="flabel" id="rv_rl">Your rating *</span><div class="rvstars" id="rvst" role="group" aria-labelledby="rv_rl">${[1,2,3,4,5].map(i=>`<button type="button" data-s="${i}" aria-label="${i} star">★</button>`).join('')}</div></div>
        <div class="fld"><label for="rv_n">Your name *</label><input id="rv_n" placeholder="e.g. Nusrat" autocomplete="name"></div>
        <div class="fld"><label for="rv_t">Your review *</label><textarea id="rv_t" rows="3" placeholder="How do the posters look on your wall?"></textarea></div>
        <button class="btn btn-lime btn-block" id="rv_b">Submit review</button>
        <p class="rvnote">Reviews appear after a quick check by our team.</p>
      </div>
    </div></section>`;
    // the form stays folded away until someone wants to write a review
    const ob=document.getElementById('rv_open'), wrap=rv.querySelector('.rvwrap');
    ob.onclick=()=>{ const open=wrap.classList.toggle('rvclosed')===false; ob.setAttribute('aria-expanded',open); ob.textContent=open?'Close':'Write a review'; if(open) document.getElementById('rv_n').focus(); };
    let rate=0;
    rv.querySelectorAll('#rvst button').forEach(b=>b.onclick=()=>{ rate=+b.dataset.s;
      rv.querySelectorAll('#rvst button').forEach(x=>x.classList.toggle('on',+x.dataset.s<=rate)); });
    document.getElementById('rv_b').onclick=async()=>{
      const btn=document.getElementById('rv_b');
      const body={name:document.getElementById('rv_n').value.trim(),rating:rate,text:document.getElementById('rv_t').value.trim()};
      if(!body.name) return H.toast('Please enter your name');
      if(!rate) return H.toast('Please choose a star rating');
      if(body.text.length<4) return H.toast('Please write a short review');
      btn.disabled=true; btn.textContent='Submitting…';
      try{ await H.api('/api/products/'+encodeURIComponent(P.slug)+'/reviews',{method:'POST',body});
        H.toast('Thanks! Your review is awaiting approval.',true); loadReviews();
      }catch(e){ H.toast(e.message); btn.disabled=false; btn.textContent='Submit review'; }
    };
  }
  loadReviews();
}catch(e){
  el.innerHTML = H.empty('😕','Set not found','This poster set may have been removed.','<a class="btn btn-lime" href="/shop">Browse all sets</a>');
  document.title='Not found — Highstreet Society';
}
})();
