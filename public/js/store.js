/* HSS shared storefront logic */
window.HSS = window.HSS || {};
(function(){
const H = window.HSS;
H.settings = null; H._catMap = {};

/* ---- safe storage ----------------------------------------------------
   Sandboxed iframes (and Safari private mode) throw a SecurityError on any
   localStorage/sessionStorage access. Every read/write goes through this
   shim, which silently falls back to an in-memory store so login, cart and
   sessions keep working instead of throwing and halting the script.       */
function makeStore(kind){
  let backing = null;
  try{
    const s = window[kind];
    const probe = '__hss_probe__';
    s.setItem(probe,'1'); s.removeItem(probe);
    backing = s;
  }catch(e){ backing = null; }
  const mem = Object.create(null);
  return {
    available: !!backing,
    get(k){
      if(backing){ try{ return backing.getItem(k); }catch(e){} }
      return k in mem ? mem[k] : null;
    },
    set(k,v){
      v = String(v); mem[k] = v;
      if(backing){ try{ backing.setItem(k,v); return true; }catch(e){} }
      return false;
    },
    remove(k){
      delete mem[k];
      if(backing){ try{ backing.removeItem(k); }catch(e){} }
    }
  };
}
H.store = makeStore('localStorage');
H.session = makeStore('sessionStorage');
H.storageBlocked = !H.store.available;

/* When storage is blocked AND cookies are unavailable (an opaque-origin
   sandboxed iframe), keep the admin token in the URL fragment so a refresh
   still restores the real session. The fragment is never sent to the server
   and is only used as a last-resort carrier. */
H.tokenFallback = {
  read(){
    if(!H.storageBlocked) return null;
    // 1) URL fragment (survives history.replaceState within the same document)
    const m = /(?:^|[#&])t=([^&]+)/.exec(location.hash||'');
    if(m) return decodeURIComponent(m[1]);
    // 2) window.name — survives a full reload/navigation of the SAME frame even
    //    when cookies and storage are both unavailable (sandboxed iframe).
    try{
      const n = String(window.name||'');
      if(n.startsWith('hss:')){
        const o = JSON.parse(n.slice(4));
        if(o && o.t) return o.t;
      }
    }catch(e){}
    return null;
  },
  readRefresh(){
    if(!H.storageBlocked) return null;
    try{
      const n = String(window.name||'');
      if(n.startsWith('hss:')){
        const o = JSON.parse(n.slice(4));
        if(o && o.r) return o.r;
      }
    }catch(e){}
    return null;
  },
  write(tok, refresh){
    if(!H.storageBlocked || !tok) return;
    try{ history.replaceState(null,'', location.pathname+location.search+'#t='+encodeURIComponent(tok)); }catch(e){}
    try{
      let cur = {};
      const n = String(window.name||'');
      if(n.startsWith('hss:')){ try{ cur = JSON.parse(n.slice(4))||{}; }catch(e){} }
      cur.t = tok;
      if(refresh) cur.r = refresh;
      window.name = 'hss:' + JSON.stringify(cur);
    }catch(e){}
  },
  clear(){
    if(!H.storageBlocked) return;
    try{ history.replaceState(null,'', location.pathname+location.search); }catch(e){}
    try{ if(String(window.name||'').startsWith('hss:')) window.name=''; }catch(e){}
  }
};

H.money = n => '৳' + Number(n||0).toLocaleString('en-IN');
H.esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

H.api = async (path, opts={}) => {
  const headers = Object.assign({}, opts.headers||{});
  const isForm = opts.body instanceof FormData;
  if(!isForm) headers['Content-Type']='application/json';
  let tok = null;
  if(opts.admin){
    // Priority: the token from THIS session first. A stale token in storage
    // (left by an older tab/session) must never override the current one.
    tok = H.memToken || HSS.store.get('hss_admin_token') || H.tokenFallback.read() || null;
  } else {
    tok = HSS.store.get('hss_token') || null;
  }
  if(tok) headers['Authorization']='Bearer '+tok;
  // Proxies in some hosting environments strip Authorization headers and
  // cookies from cross-origin iframe traffic. Also carry the admin token as a
  // query parameter so the session cannot be lost in transit.
  if(tok){
    // Applies to BOTH admin and customer sessions: some hosting proxies strip
    // Authorization headers and cookies, so also carry the token in the URL.
    path += (path.indexOf('?') < 0 ? '?' : '&') + '__t=' + encodeURIComponent(tok);
  }
  // NOTE: deliberately NO custom request headers here.
  // A custom header (e.g. X-HSS-Refresh) turns every admin call into a
  // CORS-preflighted request. A preflight cached by the browser from an older
  // build (Access-Control-Max-Age) can then block EVERY admin request locally,
  // without ever reaching the server. Only Authorization/Content-Type are used;
  // the refresh grant travels in the refresh request's BODY instead.
  // credentials:'include' so the HttpOnly session cookie is sent even when
  // localStorage is unavailable (sandboxed preview iframe, Safari private mode).
  let r;
  try{
    r = await fetch(path, { method:opts.method||'GET', headers, credentials:'include',
      body: opts.body?(isForm?opts.body:JSON.stringify(opts.body)):undefined });
  }catch(networkErr){
    // fetch() rejects (offline, DNS, proxy drop, CORS). Mark it clearly so
    // callers can distinguish "cannot reach server" from "not authenticated".
    const err = new Error('Cannot reach the server. Please check your connection.');
    err.network = true;   // no .status on purpose
    throw err;
  }
  // Pick up a server-renewed session token (sliding sessions) so the client
  // always holds the freshest credential.
  if(opts.admin){
    try{
      const nt = r.headers.get('X-HSS-New-Token');
      if(nt){
        H.memToken = nt;
        HSS.store.set('hss_admin_token', nt);
        if(H.tokenFallback && H.tokenFallback.write) H.tokenFallback.write(nt, H.memRefresh);
      }
    }catch(e){}
  }
  const data = await r.json().catch(()=>({}));
  if(!r.ok){
    const err = new Error(data.error||('Request failed ('+r.status+')'));
    err.status = r.status;
    if(data.reason) err.reason = data.reason;
    throw err;
  }
  return data;
};

H.toast = (msg, ok=false) => {
  let box = document.getElementById('toasts');
  if(!box){ box=document.createElement('div'); box.id='toasts'; document.body.appendChild(box); }
  const t=document.createElement('div'); t.className='toast'+(ok?' ok':''); t.textContent=msg;
  box.appendChild(t); setTimeout(()=>{t.style.opacity='0';t.style.transition='.3s';setTimeout(()=>t.remove(),320);}, 2600);
};

/* ---- cart ---- */
H.getCart = () => { try{ return JSON.parse(HSS.store.get('hss_cart')||'[]'); }catch(e){ return []; } };
H.setCart = c => { HSS.store.set('hss_cart', JSON.stringify(c)); H.updateBadges(); H.trackCart&&H.trackCart(); };
H.cartCount = () => H.getCart().reduce((s,i)=>s+(i.qty||1),0);
H.addToCart = (id, qty=1, size=null) => {
  const c=H.getCart(); const f=c.find(i=>i.id===id && (i.size||null)===(size||null));
  if(f) f.qty=Math.min(20,(f.qty||1)+qty); else c.push(size?{id,qty,size}:{id,qty});
  H.setCart(c); H.toast(size?`Added to cart (size ${size})`:'Added to cart', true);
};

/* ---- wishlist ---- */
H.getWish = () => { try{ return JSON.parse(HSS.store.get('hss_wish')||'[]'); }catch(e){ return []; } };
H.inWish = id => H.getWish().includes(id);
H.toggleWish = id => {
  let w=H.getWish();
  if(w.includes(id)){ w=w.filter(x=>x!==id); H.toast('Removed from wishlist'); }
  else { w.push(id); H.toast('Saved to wishlist', true); }
  HSS.store.set('hss_wish', JSON.stringify(w)); H.updateBadges();
  document.querySelectorAll('.wish[data-w="'+id+'"]').forEach(b=>b.classList.toggle('on', w.includes(id)));
};
H.updateBadges = () => {
  const cc=H.cartCount(), wc=H.getWish().length;
  document.querySelectorAll('[data-badge="cart"]').forEach(b=>{b.textContent=cc;b.style.display=cc?'grid':'none';});
  document.querySelectorAll('[data-badge="wish"]').forEach(b=>{b.textContent=wc;b.style.display=wc?'grid':'none';});
};


/* ---- social links that open the real apps ---- */
H.waNumber = n => { n=String(n||'').replace(/\D/g,''); if(n.startsWith('880')) return n;
  if(n.startsWith('0')) return '880'+n.slice(1); if(n.length===10) return '880'+n; return n; };
H.socialUrl = kind => {
  const c=(H.settings&&H.settings.contact)||{};
  if(kind==='whatsapp'){ if(!c.whatsapp) return ''; 
    return 'https://wa.me/'+H.waNumber(c.whatsapp)+'?text='+encodeURIComponent('Hi Highstreet Society! I have a question about your poster sets.'); }
  if(kind==='messenger'){ return c.facebook||''; }
  return c[kind]||'';
};
H.social = (kind, label, cls='btn-ghost') => {
  const u=H.socialUrl(kind); if(!u) return '';
  return `<a class="btn ${cls}" href="${H.esc(u)}" target="_blank" rel="noopener noreferrer">${H.esc(label)}</a>`;
};

/* ---- abandoned-cart ping (fire and forget) ---- */
H.trackCart = () => {
  const items=H.getCart(); if(!items.length) return;
  let key=HSS.store.get('hss_cart_key');
  if(!key){ key='ac'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); HSS.store.set('hss_cart_key',key); }
  clearTimeout(H._ctT);
  H._ctT=setTimeout(()=>{ fetch('/api/cart/track',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key,items,name:HSS.store.get('hss_name')||'',mobile:HSS.store.get('hss_mobile')||''}),
    keepalive:true}).catch(()=>{}); }, 1200);
};

/* ---- product card ---- */
H.card = p => {
  const out = !(p.stock>0||p.allowBackorder);
  return `<div class="card">
    <a class="ph" href="/product/${p.slug}" aria-label="${H.esc(p.name)}">
      <img src="${H.esc(p.cover)}" alt="${H.esc(p.name)}" loading="lazy" decoding="async" onerror="this.src='/images/logo.png'">
      <span class="tags">${out?'<span class="ptag out">SOLD OUT</span>':p.discountPct?'<span class="ptag off">-'+p.discountPct+'%</span>':p.isNew?'<span class="ptag new">NEW</span>':p.bestseller?'<span class="ptag best">BESTSELLER</span>':''}</span>
    </a>
    <button class="wish ${H.inWish(p.id)?'on':''}" data-w="${p.id}" onclick="event.preventDefault();HSS.toggleWish('${p.id}')" aria-label="wishlist">
      <svg viewBox="0 0 24 24" fill="${H.inWish(p.id)?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
    </button>
    <div class="pb">
      <span class="setno">SET ${H.esc(p.setNo||'--')}</span>
      <a href="/product/${p.slug}"><h3>${H.esc(p.name)}</h3></a>
      <span class="meta">${p.type==='clothing'?((p.sizes||[]).map(x=>H.esc(x.size)).join(' · ')||'Apparel'):p.type==='combo'?((p.bundleItems||[]).length+' items in bundle'):'6 posters • '+H.esc(p.posterSize||'A4')+' • '+H.esc(p.boardThickness||'3mm')+' board'}</span>
      <div class="prow">
        <span class="price">${p.salePrice&&p.salePrice<p.price?`<s>${H.money(p.price)}</s>`:''}${H.money(p.effPrice)}</span>
        ${out?'<span class="meta">Restocking soon</span>':(p.sizes&&p.sizes.length?`<a class="addbtn" href="/product/${p.slug}">PICK SIZE</a>`:`<button class="addbtn" onclick="HSS.addToCart('${p.id}')">ADD +</button>`)}
      </div>
    </div>
  </div>`;
};

H.empty = (e,h,s,btn='') => `<div class="empty"><div class="e">${e}</div><h3>${h}</h3><p>${s}</p><div style="margin-top:18px">${btn}</div></div>`;

H.statusPill = s => `<span class="pillst st-${s}">${String(s).replace(/-/g,' ')}</span>`;

/* ---- layout ---- */
const ICO = {
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  bag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 7h15l-1.5 13.5a1 1 0 0 1-1 .5H8.5a1 1 0 0 1-1-.5L6 7z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10.5L12 3l9 7.5V21H3z"/></svg>',
  grid:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  menu:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
};

H.renderLayout = async (active='') => {
  try{ const c=HSS.session.get('hss_settings'); if(c) H.settings=JSON.parse(c); }catch(e){}
  try{ H.settings = await H.api('/api/settings'); HSS.session.set('hss_settings',JSON.stringify(H.settings)); }
  catch(e){ if(!H.settings) H.settings = null; }
  const s = H.settings||{};
  if(s.announcement){ const a=document.getElementById('announce'); if(a) a.textContent=s.announcement; }
  const hdr = document.getElementById('hdr');
  if(hdr){
    hdr.innerHTML = `<div class="wrap hbar">
      <button class="icobtn burger" onclick="document.getElementById('mmenu').classList.add('open')" aria-label="menu">${ICO.menu}</button>
      <a class="logo" href="/"><img src="/images/logo.png" alt="Highstreet Society logo"><span>HIGHSTREET<br><small>SOCIETY • EST 2025</small></span></a>
      <nav class="main">
        <a href="/" class="${active==='home'?'on':''}">Home</a>
        <a href="/shop" class="${active==='shop'?'on':''}">Shop</a>
        <a href="/custom-design" class="${active==='custom'?'on':''}">Custom Design</a>
        <a href="/track" class="${active==='track'?'on':''}">Track Order</a>
        <a href="/about" class="${active==='about'?'on':''}">About</a>
        <a href="/contact" class="${active==='contact'?'on':''}">Contact</a>
      </nav>
      <div class="hicons">
        <button class="icobtn" onclick="location.href='/shop';setTimeout(()=>{const i=document.getElementById('q');if(i)i.focus();},300)" aria-label="search">${ICO.search}</button>
        <a class="icobtn hide-sm" href="/wishlist" aria-label="wishlist">${ICO.heart}<span class="badge" data-badge="wish" style="display:none">0</span></a>
        <a class="icobtn" href="/cart" aria-label="cart">${ICO.bag}<span class="badge" data-badge="cart" style="display:none">0</span></a>
        <a class="icobtn hide-sm" href="/account" aria-label="account">${ICO.user}</a>
      </div>
    </div>`;
  }
  const mm = document.getElementById('mmenu');
  if(mm){
    mm.innerHTML = `<div class="scrim" onclick="document.getElementById('mmenu').classList.remove('open')"></div>
      <div class="panel">
        <a class="logo" href="/" style="margin-bottom:18px"><img src="/images/logo.png" alt="logo"><span>HIGHSTREET<br><small>SOCIETY</small></span></a>
        <a class="mlink" href="/">Home</a><a class="mlink" href="/shop">Shop All Sets</a>
        <a class="mlink" href="/shop?filter=new">New Arrivals</a><a class="mlink" href="/shop?filter=best">Best Sellers</a>
        <a class="mlink" href="/custom-design">✦ Custom Design</a><a class="mlink" href="/track">Track Order</a><a class="mlink" href="/wishlist">Wishlist</a>
        <a class="mlink" href="/account">My Account</a><a class="mlink" href="/about">About</a><a class="mlink" href="/contact">Contact</a>
        <div style="margin-top:16px;display:flex;gap:10px">
          ${s.contact&&s.contact.instagram?`<a class="btn btn-ghost btn-sm" href="${H.esc(s.contact.instagram)}" target="_blank" rel="noopener">Instagram</a>`:''}
          ${s.contact&&s.contact.facebook?`<a class="btn btn-ghost btn-sm" href="${H.esc(s.contact.facebook)}" target="_blank" rel="noopener">Facebook</a>`:''}
        </div>
      </div>`;
  }
  const ftr = document.getElementById('ftr');
  if(ftr && s.brand){
    const c=s.contact||{};
    ftr.innerHTML = `<div class="wrap"><div class="fgrid">
      <div class="fbrand">
        <a class="logo" href="/"><img src="/images/logo.png" alt="logo"><span>HIGHSTREET<br><small>SOCIETY</small></span></a>
        <p>${H.esc(s.brand.tagline||'')}. Every set: six premium A4 posters on 3mm board.</p>
        <div class="socials">
          ${c.instagram?`<a href="${H.esc(c.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg></a>`:''}
          ${c.facebook?`<a href="${H.esc(c.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h-2.5A4.5 4.5 0 0 0 8 7.5V10H5v4h3v7h4v-7h3l1-4h-4V7.5A1.5 1.5 0 0 1 13.5 6H15z"/></svg></a>`:''}
          ${c.whatsapp?`<a href="${H.esc(H.socialUrl('whatsapp'))}" target="_blank" rel="noopener" aria-label="WhatsApp"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1s-.5-.2-.7.1-.8 1-.9 1.2-.3.2-.6.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.6l-1-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4C6.4 7.3 6 8.3 6 9.5c0 1.2.5 2.4.6 2.6.2.2 1.9 3.5 5 4.8 1.8.8 2.6.9 3.5.7.5-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4s-.3-.2-.6-.4z"/><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg></a>`:''}
        </div>
      </div>
      <div><h4>SHOP</h4><a href="/shop">All Poster Sets</a><a href="/custom-design">Custom Design</a><a href="/shop?filter=new">New Arrivals</a><a href="/shop?filter=best">Best Sellers</a><a href="/track">Track Order</a></div>
      <div><h4>HELP</h4><a href="/about">About Us</a><a href="/contact">Contact</a><a href="/policy/shipping">Shipping & Delivery</a><a href="/policy/returns">Returns & Refunds</a><a href="/policy/faq">FAQ</a><a href="/policy/privacy">Privacy Policy</a><a href="/policy/terms">Terms & Conditions</a></div>
      <div><h4>CONTACT</h4>${c.mobile?`<a href="tel:${H.esc(c.mobile)}">${H.esc(c.mobile)}</a>`:''}${c.address?`<a>${H.esc(c.address)}</a>`:''}<div class="paychips" style="margin-top:12px"><span>COD</span><span>bKash</span><span>Nagad</span></div></div>
    </div>
    <div class="fbot"><span>© 2026 ${H.esc(s.brand.name)}. All rights reserved.</span><span>Born on the streets • EST. ${H.esc(s.brand.est||'2025')}</span></div></div>`;
  }
  const tab = document.getElementById('tabbar');
  if(tab){
    tab.innerHTML = `
      <a href="/" class="${active==='home'?'on':''}">${ICO.home}Home</a>
      <a href="/shop" class="${active==='shop'?'on':''}">${ICO.grid}Shop</a>
      <a href="/wishlist" class="${active==='wish'?'on':''}">${ICO.heart}Saved<span class="badge" data-badge="wish" style="display:none">0</span></a>
      <a href="/cart" class="${active==='cart'?'on':''}">${ICO.bag}Cart<span class="badge" data-badge="cart" style="display:none">0</span></a>
      <a href="/account" class="${active==='account'?'on':''}">${ICO.user}Account</a>`;
  }
  // floating WhatsApp button (mobile-first support)
  if(!document.getElementById('wafab')){
    const u=H.socialUrl('whatsapp');
    if(u){ const a=document.createElement('a'); a.id='wafab'; a.className='wafab'; a.href=u;
      a.target='_blank'; a.rel='noopener noreferrer'; a.setAttribute('aria-label','Chat on WhatsApp');
      a.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.2-1.7-.9-2-1s-.5-.2-.7.1-.8 1-.9 1.2-.3.2-.6.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.6l-1-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4C6.4 7.3 6 8.3 6 9.5c0 1.2.5 2.4.6 2.6.2.2 1.9 3.5 5 4.8 1.8.8 2.6.9 3.5.7.5-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4s-.3-.2-.6-.4z"/><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>';
      document.body.appendChild(a); }
  }
  H.updateBadges();
};

H.catName = id => (H._catMap[id]||id||'').toString();
H.loadCats = async () => {
  try{ const d=await H.api('/api/categories'); d.forEach(c=>H._catMap[c.id]=c.name); return d; }catch(e){ return []; }
};
H.loggedIn = () => !!HSS.store.get('hss_token');
H.logout = async () => { try{ await H.api('/api/auth/logout',{method:'POST'}); }catch(e){} HSS.store.remove('hss_token'); location.href='/'; };
})();
