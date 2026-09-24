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

  GIMGS = [P.cover, ...(P.posters||[])].filter(Boolean);
  LIMGS = GIMGS;
  const out = !(P.stock>0||P.allowBackorder);
  const low = !out && P.stock<=5;

  el.innerHTML = `
  <div class="crumbs"><a href="/">Home</a> / <a href="/shop">Shop</a> / <span>${H.esc(P.name)}</span></div>
  <div class="pdp">
    <div class="gal">
      <div class="gmain" onclick="POPEN(${0})" id="gmain">
        <img id="gimg" src="${H.esc(GIMGS[0])}" alt="${H.esc(P.name)}" fetchpriority="high" onerror="this.src='/images/logo.png'">
        <span class="count" id="gcount">1 / ${GIMGS.length} — Cover</span>
        <button class="gnav l" onclick="event.stopPropagation();GNAV(-1)">‹</button>
        <button class="gnav r" onclick="event.stopPropagation();GNAV(1)">›</button>
      </div>
      <div class="gthumbs" id="gthumbs">${GIMGS.map((g,i)=>`<button class="${i===0?'on':''}" data-i="${i}" aria-label="view ${i===0?'cover':'poster '+(i)}"><img src="${H.esc(g)}" alt="" loading="lazy" onerror="this.src='/images/logo.png'"></button>`).join('')}</div>
      <div class="ghint">${P.type==='poster'?'1 set = 6 posters · tap to zoom':'Tap to zoom'}</div>
    </div>
    <div class="pinfo">
      <span class="setno">${P.type==='poster'?'SET '+H.esc(P.setNo||'--'):H.esc((P.type||'').toUpperCase())} ${P.isNew?'• NEW':''} ${P.bestseller?'• BESTSELLER':''}</span>
      <h1>${H.esc(P.name)}</h1>
      <p class="sub">${H.esc(P.short||'')}</p>
      <div class="pricerow"><span class="now">${H.money(P.effPrice)}</span>${P.salePrice&&P.salePrice<P.price?`<s>${H.money(P.price)}</s><span class="savechip">SAVE ${P.discountPct}%</span>`:''}</div>
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
      ${out?'':`<div class="buyrow">
        <div class="qty"><button onclick="PQTY(-1)">−</button><b id="pq">1</b><button onclick="PQTY(1)">+</button></div>
        <button class="btn btn-lime" onclick="PADD()">Add to Cart</button>
      </div>
      <div class="wishrow">
        <button class="btn btn-brand" onclick="PBUY()">Buy Now</button>
        <button class="btn btn-ghost" onclick="HSS.toggleWish('${P.id}');this.classList.toggle('on')">${H.inWish(P.id)?'♥ Saved':'♡ Wishlist'}</button>
      </div>`}
      ${out?`<div class="buyrow"><button class="btn btn-ghost btn-block" onclick="HSS.toggleWish('${P.id}')">♡ Notify me — Save to wishlist</button></div>`:''}
      <div class="acc">
        <details open><summary>About this set</summary><div class="ab">${H.esc(P.description||'Premium 6-poster wall set.').replace(/\n/g,'<br>')}</div></details>
        <details><summary>Size & material</summary><div class="ab">${P.type==='poster'
  ? `• 6 different ${H.esc(P.posterSize||'A4')} posters (21 × 29.7 cm)<br>• Printed/mounted on rigid ${H.esc(P.boardThickness||'3mm')} premium board<br>• Ready to hang — no frames needed`
  : (P.sizes&&P.sizes.length ? '• Available sizes: '+P.sizes.map(x=>H.esc(x.size)).join(', ') : '• One size')}<br>• SKU: ${H.esc(P.sku||'—')}</div></details>
        <details><summary>Delivery & payment</summary><div class="ab">• Inside Dhaka: ${H.money(H.settings.delivery.inside)} • Outside Dhaka: ${H.money(H.settings.delivery.outside)}<br>• Cash on Delivery, bKash & Nagad accepted<br>• Track your order anytime with your Order ID + mobile number</div></details>
      </div>
      ${P.tags&&P.tags.length?`<div class="glabels" style="margin-top:14px">${P.tags.map(t=>`<a href="/shop?q=${encodeURIComponent(t)}"><span>#${H.esc(t)}</span></a>`).join('')}</div>`:''}
    </div>
  </div>
  ${d.related&&d.related.length?`<section class="block" style="padding-top:10px"><div class="shead"><div><h2>COMPLETE THE <span class="l">WALL</span></h2></div><a class="more" href="/shop">All sets →</a></div><div class="rail">${d.related.map(H.card).join('')}</div></section>`:''}
  `;

  window.GNAV = dd => {
    gidx=(gidx+dd+GIMGS.length)%GIMGS.length;
    document.getElementById('gimg').src=GIMGS[gidx];
    document.getElementById('gmain').setAttribute('onclick',`POPEN(${gidx})`);
    document.getElementById('gcount').textContent=(gidx+1)+' / '+GIMGS.length+(gidx===0?' — Cover':' — Poster '+gidx);
    document.querySelectorAll('#gthumbs button').forEach(b=>b.classList.toggle('on',+b.dataset.i===gidx));
  };
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
    </div></div>
    <div class="rvwrap">
      <div class="rvlist">${d.reviews.length?d.reviews.map(r=>`<div class="rvitem">
        <div class="rvtop"><b>${H.esc(r.name)}</b>${stars(r.rating)}</div>
        <p>${H.esc(r.text)}</p>
        <span class="rvdate">${new Date(r.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
      </div>`).join(''):'<p class="rvnone">No reviews yet — your feedback helps other shoppers.</p>'}</div>
      <div class="panel rvform">
        <h2>Write a review</h2>
        <div class="fld"><label>Your rating *</label><div class="rvstars" id="rvst">${[1,2,3,4,5].map(i=>`<button type="button" data-s="${i}" aria-label="${i} star">★</button>`).join('')}</div></div>
        <div class="fld"><label>Your name *</label><input id="rv_n" placeholder="e.g. Nusrat"></div>
        <div class="fld"><label>Your review *</label><textarea id="rv_t" rows="3" placeholder="How do the posters look on your wall?"></textarea></div>
        <button class="btn btn-lime btn-block" id="rv_b">Submit review</button>
        <p class="rvnote">Reviews appear after a quick check by our team.</p>
      </div>
    </div></section>`;
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
