/* HSS Admin SPA */
(function(){
const H=HSS;
const root=document.getElementById('root');
const A={ counts:{}, tab:'dash', products:[], cats:[], orders:[], customers:[], homepage:null, settings:null, coupons:[], stats:null, orderFilter:'', orderQ:'', editId:null };
const api=(p,o)=>H.api(p,Object.assign({admin:true},o||{}));
const esc=H.esc, money=H.money;

function toast(m,ok){ H.toast(m,!!ok); }

/* ---------- auth state machine ----------
   Exactly one owner of the root view at a time. Every async task captures the
   session generation it started under; when it finishes it may only touch the
   DOM if it is still the current generation. This removes the race where a
   slow/stale background check completed after login and overwrote the
   authenticated dashboard (the dashboard/login "blinking"). */
const AUTH = {
  state: 'unknown',   // 'unknown' | 'authed' | 'anon'
  gen: 0,             // bumped on every login/logout
  shellMounted: false
};
function newGen(){ return ++AUTH.gen; }
function isStale(gen){ return gen !== AUTH.gen; }
function setAuthed(){ AUTH.state='authed'; }
function setAnon(){ AUTH.state='anon'; AUTH.shellMounted=false; }

/* Records why a login attempt failed, so the exact step is visible in the UI
   and console without exposing tokens or credentials. */
function LOGDIAG(step, detail){
  const line = '[HSS admin] '+step+(detail?': '+String(detail).slice(0,120):'');
  try{ console.error(line); }catch(e){}
  window.HSS_LAST_ERROR = line;
}


/* ---------- login ---------- */
function loginView(reason, prefillUser){
  AUTH.shellMounted = false;
  setAnon();
  root.innerHTML=`<div class="loginbox"><div class="panel">
    <img src="/images/logo.png" alt="HSS"><h1 style="font-size:22px">HSS ADMIN</h1>
    <p class="asub">Manage your poster business</p>
    ${reason?`<p class="asub" style="color:var(--gold,#FBBF24);margin-top:-4px">${esc(reason)}</p>`:''}
    <div class="fld" style="text-align:left"><label>Username</label><input id="u" autocomplete="username" value="${esc(prefillUser||'')}"></div>
    <div class="fld" style="text-align:left"><label>Password</label><input id="p" type="password" autocomplete="current-password"></div>
    <button class="abtn lime btn-block" id="lbtn" style="width:100%;padding:14px" onclick="ALOGIN()">Login →</button>
    <p style="margin-top:16px"><a href="/" style="color:var(--mut);font-size:13.5px">← Back to store</a></p>
  </div></div>`;
  const submit = async () => {
    const btn = document.getElementById('lbtn');
    const username = document.getElementById('u').value.trim();
    const password = document.getElementById('p').value;
    if(!username || !password) return toast('Enter your username and password');
    btn.disabled = true; btn.textContent = 'Signing in…';
    let d;
    try{
      d = await H.api('/api/admin/login',{method:'POST',body:{username,password}});
    }catch(e){
      // 401 = bad credentials: show the server's exact message (unchanged).
      // Network failure = say so explicitly instead of implying bad credentials.
      toast(e.network ? e.message : (e.message || 'Wrong username or password'));
      LOGDIAG('login-request-failed', (e.status||'network')+' '+(e.message||''));
      btn.disabled = false; btn.textContent = 'Login →';
      return;
    }
    // Login succeeded. Persist the token, but NEVER let a storage
    // SecurityError (sandboxed iframe) stop us reaching the dashboard —
    // the HttpOnly cookie set by the server authenticates us either way.
    // Login succeeded: this response IS the proof of authentication.
    const gen = newGen();      // invalidates any in-flight pre-login check
    storeCredentials(d.token, d.refresh);
    setAuthed();

    // Render the dashboard straight from the login result. Nothing after this
    // point is allowed to send the admin back to the login form.
    shell(true);
    await run();
    refreshCounts(gen).then(()=>{ if(!isStale(gen)) syncShell(); }).catch(()=>{});
  };
  window.ALOGIN = submit;
  ['u','p'].forEach(id=>{
    const f=document.getElementById(id);
    if(f) f.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
  });
  const uf=document.getElementById('u'); if(uf) uf.focus();
}

/* ---------- shell ---------- */
const NAV=[
  ['dash','▦ Dashboard'],
  ['analytics','📈 Analytics'],
  ['products','▧ Products'],
  ['cats','🗂 Categories','catN'],
  ['orders','📦 Orders','ordN'],
  ['inv','⚖ Inventory'],
  ['reviews','☆ Reviews','revN'],
  ['promos','🔥 Promotions'],
  ['coupons','🏷 Coupons'],
  ['customers','👥 Customers','cusN'],
  ['carts','🛒 Abandoned Carts','cartN'],
  ['designs','🎨 Custom Designs','dsgN'],
  ['home','🏠 Homepage'],
  ['exhibit','🎨 Poster Exhibition'],
  ['content','📄 Content / CMS'],
  ['pay','🚚 Delivery & Payments'],
  ['settings','⚙ Store Settings']
];
function counts(){
  return {
    ordN:(A.orders.filter(o=>['pending','payment-pending'].includes(o.status)).length)||'',
    catN:A.counts.cats||'', revN:A.counts.reviews||'', cusN:A.counts.customers||'', cartN:A.counts.carts||'',
    dsgN:A.counts.designs||''
  };
}
/* Update only the badge numbers + active tab. Never rebuilds the dashboard,
   so refreshed counts can't cause a visible flash. */
function syncShell(){
  if(!AUTH.shellMounted) return;
  const C=counts();
  const btns=root.querySelectorAll('.anav button');
  NAV.forEach((n,i)=>{
    const b=btns[i]; if(!b) return;
    b.classList.toggle('on', A.tab===n[0]);
    const want = n[2] && C[n[2]] ? String(C[n[2]]) : '';
    let badge=b.querySelector('.n');
    if(want){
      if(!badge){ badge=document.createElement('span'); badge.className='n'; b.appendChild(badge); }
      if(badge.textContent!==want) badge.textContent=want;
    } else if(badge) badge.remove();
  });
  const alert=root.querySelector('.atop .abtn.ghost.sm[onclick*="orders"]');
  if(alert){ const want='🔔 Payment Alerts'+(C.ordN?` (${C.ordN})`:''); if(alert.textContent!==want) alert.textContent=want; }
}
function shell(force){
  // Mount the chrome once. Subsequent calls only patch it in place.
  if(AUTH.shellMounted && !force){ syncShell(); return; }
  const C=counts();
  root.innerHTML=`<div class="adm">
    <aside class="aside" id="aside">
      <a class="logo" href="/" style="margin:0 8px 18px"><img src="/images/logo.png" alt=""><span>HIGH STREET<br><small>SOCIETY • EST. 2025</small></span></a>
      <nav class="anav">${NAV.map(n=>`<button class="${A.tab===n[0]?'on':''}" onclick="GOTAB('${n[0]}')">${n[1]}${n[2]&&C[n[2]]?`<span class="n">${C[n[2]]}</span>`:''}</button>`).join('')}</nav>
      <div class="afoot">
        <button onclick="window.open('/','_blank')">◉ View Live Store</button>
        <button class="danger" onclick="ALOGOUT()">⏻ Logout Admin</button>
      </div>
    </aside>
    <main class="amain">
      <div class="atop">
        <button class="abtn ghost sm admmenu-btn" onclick="document.getElementById('aside').classList.toggle('open')">☰ Menu</button>
        <div class="atop-s">STORE STATUS: <b class="on">LIVE ONLINE</b> <i></i></div>
        <div class="atop-s amber">PAYMENT WORKFLOW: <b>MANUAL VERIFICATION MODE</b></div>
        <button class="abtn ghost sm" style="margin-left:auto" onclick="GOTAB('orders')">🔔 Payment Alerts${C.ordN?` (${C.ordN})`:''}</button>
      </div>
      <div class="ascrim" onclick="document.getElementById('aside').classList.remove('open')"></div>
      <div id="pane"></div>
    </main>
  </div>`;
  AUTH.shellMounted = true;
  window.GOTAB=t=>{ A.tab=t; A.editId=null;
    const a=document.getElementById('aside'); if(a) a.classList.remove('open');
    syncShell(); run(); };
  window.ALOGOUT=async()=>{
    newGen();                       // invalidate every in-flight task
    setAnon();
    try{ await api('/api/admin/logout',{method:'POST', body:{}}); }catch(e){}
    clearCredentials();
    location.reload();
  };
}
async function refreshCounts(gen){
  try{
    const [o,r,c,ac,cat]=await Promise.all([
      api('/api/admin/orders'), api('/api/admin/reviews'), api('/api/admin/customers'),
      api('/api/admin/carts'), api('/api/admin/categories')]);
    let dsg={pending:0}; try{ dsg=await api('/api/admin/designs'); }catch(e){}
    if(isStale(gen)) return;          // a newer login/logout happened; drop these results
    A.orders=o.orders;
    A.counts={ reviews:r.pending||'', customers:(c.customers||[]).length||'',
      carts:(ac.carts||[]).length||'', cats:(cat.categories||[]).length||'',
      designs:dsg.pending||'' };
  }catch(e){}
}
async function boot(gen){
  if(gen===undefined) gen=newGen();

  // If this tab already holds a live session, go straight in.
  if(AUTH.state === 'authed'){
    shell(); await run();
    refreshCounts(gen).then(()=>{ if(!isStale(gen)) syncShell(); });
    return;
  }

  let ok = false, reachable = true;
  try{
    await api('/api/admin/me');
    ok = true;
  }catch(e){
    if(e && e.status === 401){
      // Not authenticated with the current credential -> try one renewal.
      try{ await renewSession(); ok = true; }catch(e2){ ok = false; }
    }else{
      reachable = false;               // network/5xx: do NOT treat as logged out
    }
  }

  if(isStale(gen)) return;

  if(ok){
    setAuthed();
    shell(); await run();
    refreshCounts(gen).then(()=>{ if(!isStale(gen)) syncShell(); });
    return;
  }

  if(!reachable){
    root.innerHTML=`<div class="loginbox"><div class="panel">
      <img src="/images/logo.png" alt="HSS">
      <h1 style="font-size:20px">Cannot reach the server</h1>
      <p class="asub">Please check your connection.</p>
      <button class="abtn lime" style="margin-top:12px" onclick="location.reload()">Retry</button>
    </div></div>`;
    return;
  }

  // Genuinely not signed in (first visit or after logout).
  setAnon();
  clearCredentials();
  loginView();
}

/* Ask the server for a fresh admin token. Throws if the caller is not a
   legitimate admin. This is the ONLY renewal path in the panel. */
async function renewSession(){
  // Renew WITHOUT sending the current (possibly invalid) Authorization header:
  // a stale token must not stop the browser's valid session cookie from being
  // accepted. Any stored refresh grant is passed in the body.
  const grant = (HSS.memRefresh)
    || HSS.store.get('hss_admin_refresh')
    || (HSS.tokenFallback && HSS.tokenFallback.readRefresh && HSS.tokenFallback.readRefresh())
    || undefined;
  const cur = HSS.memToken || HSS.store.get('hss_admin_token') || '';
  // Current token goes in the BODY (never the URL, which would leak it into logs).
  const body = {};
  if(grant) body.refresh = grant;
  if(cur) body.__t = cur;
  const res = await fetch('/api/admin/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  if(!res.ok) { const e = new Error('renew failed'); e.status = res.status; throw e; }
  const r = await res.json().catch(()=>({}));
  if(!r || !r.token) throw new Error('renew failed');
  storeCredentials(r.token, r.refresh || grant);
  setAuthed();
  return true;
}

function storeCredentials(token, refresh){
  HSS.memToken = token;
  HSS.store.set('hss_admin_token', token);
  if(refresh){
    HSS.memRefresh = refresh;
    HSS.store.set('hss_admin_refresh', refresh);
  }
  // window.name carries BOTH across reloads when cookies+storage are blocked
  if(HSS.tokenFallback && HSS.tokenFallback.write){
    HSS.tokenFallback.write(token, refresh || HSS.memRefresh);
  }
}
function clearCredentials(){
  HSS.memToken = null; HSS.memRefresh = null;
  HSS.store.remove('hss_admin_token');
  HSS.store.remove('hss_admin_refresh');
  if(HSS.tokenFallback && HSS.tokenFallback.clear) HSS.tokenFallback.clear();
}

/* ---------- shared bits ---------- */
function head(t,s){ return `<h1>${t}</h1><p class="asub">${s}</p>`; }
function pills(p){ return `${p.published?'':'<span class="apill r">HIDDEN</span>'}${p.featured?'<span class="apill p">FEATURED</span>':''}${p.isNew?'<span class="apill g">NEW</span>':''}${p.bestseller?'<span class="apill y">BEST</span>':''}${p.salePrice?`<span class="apill">-${p.discountPct||''}%</span>`:''}`; }
async function uploadFiles(files){
  const fd=new FormData(); [...files].forEach(f=>fd.append('images',f));
  const d=await api('/api/admin/upload',{method:'POST',body:fd});
  return d.urls;
}

/* ---------- dashboard ---------- */
async function vDash(pane){
  const s=A.stats=await api('/api/admin/stats');
  A.orders=(await api('/api/admin/orders')).orders||[];
  pane.innerHTML=`
  <div class="ahead">
    <div>${head('SOCIETY EXECUTIVE DASHBOARD','Overview of orders, real-time revenue &amp; inventory health')}</div>
    <button class="abtn pink" onclick="GOTAB('pnew')">＋ Add New Product</button>
  </div>
  <div class="kpis">
    ${kpi('Total Revenue',money(s.totals.revenue),'Confirmed / paid orders')}
    ${kpi('Pending Orders',(s.byStatus.pending||0)+(s.byStatus['payment-pending']||0),'Awaiting action')}
    ${kpi('Catalog Items',s.totals.published,s.totals.products+' total sets')}
    ${kpi('Low Stock Alerts',s.lowStock.length,'Needs restocking')}
  </div>
  <div class="aform">
    <div class="panel"><h2>Recent orders</h2>
      ${s.recent.length?s.recent.map(o=>`<div class="sumrow"><span><b>${o.id}</b> • ${esc(o.customer.name)} • ${money(o.total)}</span>${H.statusPill(o.status)}</div>`).join(''):'<p style="color:var(--mut)">No orders yet.</p>'}
      <div style="margin-top:12px"><button class="abtn ghost sm" onclick="GOTAB('orders')">All orders →</button></div>
    </div>
    <div class="panel"><h2>Top sets by sales</h2>
      ${s.top.map(p=>`<div class="sumrow"><span style="display:flex;gap:10px;align-items:center"><img src="${esc(p.cover)}" class="athumb" style="width:38px;height:46px" onerror="this.src='/images/logo.png'">${esc(p.name)}</span><span>${p.sold} sold • ${p.views} views</span></div>`).join('')}
    </div>
  </div>
  ${s.lowStock.length?`<div class="panel" style="margin-top:16px"><h2>⚠️ Low stock</h2><div class="arow">${s.lowStock.map(p=>`<span class="apill y">${esc(p.name)} — ${p.stock} left</span>`).join('')}</div></div>`:''}`;
}

/* ---------- orders ---------- */
async function vOrders(pane){
  if(!A.orders.length||true) A.orders=(await api('/api/admin/orders')).orders||[];
  const sts=['','pending','payment-pending','payment-verified','confirmed','processing','ready','shipped','delivered','cancelled'];
  function draw(){
    let list=A.orders;
    if(A.orderFilter) list=list.filter(o=>o.status===A.orderFilter);
    if(A.orderQ){ const q=A.orderQ.toLowerCase(); list=list.filter(o=>(o.id+' '+o.customer.name+' '+o.customer.mobile+' '+(o.trxId||'')).toLowerCase().includes(q)); }
    pane.innerHTML=head('Orders',list.length+' order(s)')+`
    <div class="arow" style="margin-bottom:16px">
      <select id="of" style="width:auto">${sts.map(s=>`<option value="${s}" ${A.orderFilter===s?'selected':''}>${s||'All statuses'}</option>`).join('')}</select>
      <input id="oq" placeholder="Search ID, name, mobile, TrxID…" style="max-width:280px" value="${esc(A.orderQ)}">
    </div>
    ${list.length?list.map(o=>`
    <div class="obox"><div class="oh"><div><b>${o.id}</b> <span style="color:var(--mut);font-size:13px">• ${new Date(o.createdAt).toLocaleString()}</span><br>
      <span style="font-size:13.5px">${esc(o.customer.name)} • ${esc(o.customer.mobile)} • ${esc(o.zone==='inside'?'Inside Dhaka':'Outside Dhaka')}</span>
      <span class="apill ${o.customer.customerId?'g':''}" style="margin-left:6px">${o.customer.customerId?('ACCOUNT '+esc(o.customer.customerId)):'GUEST'}</span><br>
      <span style="font-size:13px;color:var(--mut)">📍 ${esc(o.customer.fullAddress||o.customer.address)}</span><br>
      <span style="font-size:13px;color:var(--mut)">${o.coupon?'🎟️ '+esc(o.coupon)+' • ':''}${o.trxId?'TrxID: <b style="color:var(--lime)">'+esc(o.trxId)+'</b> • ':''}<a href="tel:${esc(o.customer.mobile)}">Call</a> • <a href="https://wa.me/${H.waNumber(o.customer.mobile)}" target="_blank" rel="noopener">WhatsApp</a></span></div>
      <div style="text-align:right">${H.statusPill(o.status)}<br><span class="apill" style="margin-top:6px">${o.paymentMethod.toUpperCase()} • ${esc(o.paymentStatus)}</span><br><b style="font-size:19px">${money(o.total)}</b></div></div>
      <div class="oitems">${o.items.map(i=>`<img src="${esc(i.cover)}" title="${esc(i.name)} × ${i.qty}" onerror="this.src='/images/logo.png'">`).join('')}</div>
      <div class="oline">${o.items.map(i=>`<div class="olrow"><span>${esc(i.name)}${i.size?` <b class="szchip">${esc(i.size)}</b>`:''} × ${i.qty}</span><b>${money(i.price*i.qty)}</b></div>`).join('')}
        <div class="olrow"><span>Subtotal</span><b>${money(o.subtotal)}</b></div>
        ${o.discount?`<div class="olrow"><span>Discount</span><b>−${money(o.discount)}</b></div>`:''}
        <div class="olrow"><span>Delivery (${esc(o.zone==='inside'?'Inside Dhaka':'Outside Dhaka')})</span><b>${money(o.deliveryCharge)}</b></div>
        <div class="olrow tot"><span>Total</span><b>${money(o.total)}</b></div></div>
      ${o.notes?`<div style="font-size:13px;color:var(--gold)">Note: ${esc(o.notes)}</div>`:''}
      <div class="arow" style="margin-top:12px">
        <select id="st_${o.id}" style="width:auto">${['pending','payment-pending','payment-verified','confirmed','processing','ready','shipped','delivered','cancelled'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}</select>
        <select id="ps_${o.id}" style="width:auto">${['unpaid','pending-verification','paid','failed','refunded'].map(s=>`<option ${o.paymentStatus===s?'selected':''}>${s}</option>`).join('')}</select>
        <input id="nt_${o.id}" placeholder="Add note (optional)" style="max-width:220px">
        <button class="abtn sm" onclick="OSAVE('${o.id}')">Update</button>
      </div>
      ${o.history&&o.history.length?`<details style="margin-top:10px;font-size:13px;color:var(--mut)"><summary>History (${o.history.length})</summary>${o.history.map(h=>`<div>${new Date(h.at).toLocaleString()} — ${esc(h.text)} <i>(${esc(h.by)})</i></div>`).join('')}</details>`:''}
    </div>`).join(''):H.empty('📦','No orders','Orders will appear here.')}`;
    document.getElementById('of').onchange=e=>{A.orderFilter=e.target.value;draw();};
    document.getElementById('oq').oninput=e=>{A.orderQ=e.target.value;const v=e.target.selectionStart;draw();const n=document.getElementById('oq');n.focus();n.setSelectionRange(v,v);};
  }
  window.OSAVE=async id=>{
    try{ await api('/api/admin/orders/'+id,{method:'PUT',body:{status:document.getElementById('st_'+id).value,paymentStatus:document.getElementById('ps_'+id).value,note:document.getElementById('nt_'+id).value}});
      toast('Order updated',true); A.orders=(await api('/api/admin/orders')).orders||[]; draw();
    }catch(e){ toast(e.message); }
  };
  draw();
}

/* ---------- products list ---------- */
async function vProducts(pane){
  A.products=(await api('/api/admin/products')).products||[];
  pane.innerHTML=head('Poster Sets',A.products.length+' set(s) • click edit to manage the 6 posters')+`
  <div class="arow" style="margin-bottom:16px"><button class="abtn lime" onclick="GOTAB('pnew')">➕ Add New Set</button>
  <input id="pq" placeholder="Search sets…" style="max-width:260px"></div>
  <div class="panel bulkbar" id="bulkbar" style="margin-bottom:14px;display:none"><div class="arow">
    <b id="bulkn">0 selected</b>
    <select id="bulka" style="max-width:240px">
      <option value="">Choose bulk action…</option>
      <option value="price">Set regular price ৳</option>
      <option value="sale">Set sale price ৳</option>
      <option value="salePercent">Sale: % off regular price</option>
      <option value="clearSale">Remove sale price</option>
      <option value="stock">Set stock</option>
      <option value="publish">Publish (show)</option>
      <option value="hide">Hide</option>
      <option value="addCategory">Add to category</option>
      <option value="removeCategory">Remove from category</option>
      <option value="flagOn">Turn ON a badge</option>
      <option value="flagOff">Turn OFF a badge</option>
    </select>
    <span id="bulkv"></span>
    <button class="abtn lime sm" id="bulkgo">Apply</button>
    <button class="abtn ghost sm" id="bulkclr">Clear selection</button></div></div>
  <div class="panel" style="overflow-x:auto"><table class="atable"><thead><tr><th><input type="checkbox" id="pall" style="width:auto" aria-label="select all"></th><th></th><th>Set</th><th>Price</th><th>Stock</th><th>Flags</th><th>Sold</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  function rows(f=''){
    const list=A.products.filter(p=>(p.name+p.sku+p.setNo).toLowerCase().includes(f.toLowerCase()));
    document.getElementById('rows').innerHTML=list.map(p=>`<tr>
      <td><input type="checkbox" class="psel" value="${p.id}" ${SEL.has(p.id)?'checked':''} style="width:auto" aria-label="select ${esc(p.name)}"></td>
      <td><img src="${esc(p.cover)}" class="athumb" onerror="this.src='/images/logo.png'"></td>
      <td><b>${esc(p.name)}</b><br><span style="color:var(--dim);font-size:12.5px">SET ${esc(p.setNo)} • ${esc(p.sku||'')} • ${(p.posters||[]).length} posters</span></td>
      <td><b>${money(p.effPrice)}</b>${p.salePrice?`<br><s style="color:var(--dim);font-size:12px">${money(p.price)}</s>`:''}</td>
      <td><b style="color:${p.stock===0?'var(--danger)':p.stock<=5?'var(--gold)':'var(--ok)'}">${p.stock}</b></td>
      <td>${pills(p)}</td><td>${p.sold||0}</td>
      <td><div class="arow">
        <button class="abtn sm ghost" onclick="PEDIT('${p.id}')">Edit</button>
        <button class="abtn sm ghost" onclick="PDUP('${p.id}')">Duplicate</button>
        <button class="abtn sm ghost" onclick="PUB('${p.id}',${p.published?0:1})">${p.published?'Hide':'Show'}</button>
        <button class="abtn sm danger" onclick="PDEL('${p.id}')">Delete</button>
      </div></td></tr>`).join('')||'<tr><td colspan="8">No sets found.</td></tr>';
    document.querySelectorAll('.psel').forEach(c=>c.onchange=()=>{ c.checked?SEL.add(c.value):SEL.delete(c.value); bulkUi(); });
    const all=document.getElementById('pall'); all.checked=list.length&&list.every(p=>SEL.has(p.id));
    all.onchange=()=>{ list.forEach(p=>all.checked?SEL.add(p.id):SEL.delete(p.id)); rows(document.getElementById('pq').value); bulkUi(); };
  }
  const SEL=new Set();
  function bulkUi(){
    document.getElementById('bulkbar').style.display=SEL.size?'':'none';
    document.getElementById('bulkn').textContent=SEL.size+' selected';
  }
  document.getElementById('bulka').onchange=async e=>{
    const a=e.target.value, v=document.getElementById('bulkv');
    if(['price','sale','salePercent','stock'].includes(a)) v.innerHTML=`<input id="bulkval" type="number" min="0" style="max-width:120px" placeholder="${a==='salePercent'?'e.g. 15':a==='stock'?'e.g. 20':'e.g. 420'}">`;
    else if(a==='addCategory'||a==='removeCategory'){ const cs=(await api('/api/admin/categories')).categories||[];
      v.innerHTML=`<select id="bulkval" style="max-width:200px">${cs.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>`; }
    else if(a==='flagOn'||a==='flagOff') v.innerHTML='<select id="bulkval" style="max-width:160px"><option value="featured">Featured</option><option value="isNew">New In</option><option value="bestseller">Bestseller</option></select>';
    else v.innerHTML='';
  };
  document.getElementById('bulkclr').onclick=()=>{ SEL.clear(); rows(document.getElementById('pq').value); bulkUi(); };
  document.getElementById('bulkgo').onclick=async()=>{
    const action=document.getElementById('bulka').value; if(!action) return toast('Choose a bulk action');
    const ve=document.getElementById('bulkval'); const value=ve?(ve.type==='number'?Number(ve.value):ve.value):undefined;
    if(ve&&ve.type==='number'&&ve.value==='') return toast('Enter a value');
    const label=document.getElementById('bulka').selectedOptions[0].textContent;
    if(!confirm(label+(value!==undefined?' → '+value:'')+' for '+SEL.size+' set(s)?')) return;
    try{ const r=await api('/api/admin/products/bulk',{method:'POST',body:{ids:[...SEL],action,value}});
      toast('Updated '+r.updated+' set(s)',true); SEL.clear(); vProducts(pane); }catch(e){ toast(e.message); }
  };
  rows();
  document.getElementById('pq').oninput=e=>rows(e.target.value);
  window.PEDIT=id=>{A.editId=id;A.tab='pedit';shell();run();};
  window.PDUP=async id=>{ if(!confirm('Duplicate this set?'))return; try{await api('/api/admin/products/'+id+'/duplicate',{method:'POST'});toast('Duplicated as hidden draft',true);vProducts(pane);}catch(e){toast(e.message);} };
  window.PUB=async(id,v)=>{ const p=A.products.find(x=>x.id===id); try{await api('/api/admin/products/'+id,{method:'PUT',body:Object.assign({},p,{tags:(p.tags||[]).join(', '),published:!!v})});toast(v?'Published':'Hidden',true);vProducts(pane);}catch(e){toast(e.message);} };
  window.PDEL=async id=>{ const p=A.products.find(x=>x.id===id); if(!confirm('Delete "'+p.name+'"? This cannot be undone.'))return; try{await api('/api/admin/products/'+id,{method:'DELETE'});toast('Deleted',true);vProducts(pane);}catch(e){toast(e.message);} };
}

/* ---------- product editor ---------- */
async function vPEdit(pane){
  A.cats=(await api('/api/admin/categories')).categories||[];
  let P=null;
  if(A.editId){ try{ P=(A.products||[]).find(x=>x.id===A.editId)||((await api('/api/admin/products')).products||[]).find(x=>x.id===A.editId); }catch(e){} }
  const E={ name:P?P.name:'', slug:P?P.slug:'', setNo:P?P.setNo:'', short:P?P.short:'', description:P?P.description:'',
    price:P?P.price:420, salePrice:P&&P.salePrice?P.salePrice:'', stock:P?P.stock:20, sku:P?P.sku:'', sort:P?P.sort:0,
    categoryIds:P?[...P.categoryIds]:[], tags:P?(P.tags||[]).join(', '):'', cover:P?P.cover:'', posters:P?[...P.posters]:[],
    featured:P?P.featured:false, isNew:P?P.isNew:true, bestseller:P?P.bestseller:false, published:P?P.published:true,
    allowBackorder:P?!!P.allowBackorder:false, seoTitle:P?P.seoTitle:'', seoDesc:P?P.seoDesc:'',
    type:P?(P.type||'poster'):'poster', sizes:P?JSON.parse(JSON.stringify(P.sizes||[])):[],
    bundleItems:P?[...(P.bundleItems||[])]:[], posterSize:P?(P.posterSize||'A4'):'A4',
    boardThickness:P?(P.boardThickness||'3mm'):'3mm' };
  pane.innerHTML=head(P?'Edit Product — '+esc(P.name):'Add New Product','Choose a product type, upload images, fill details, publish')+`
  <div class="fld full" style="margin-bottom:6px"><label>Product type *</label>
    <div class="typepick" id="typepick">
      ${[['poster','🖼️ Poster Set','6 A4 posters, 3mm board'],['clothing','👕 Clothing','Legacy — T-shirts, hoodies with sizes'],['combo','🎁 Combo / Bundle','Legacy — multi-item packs']].filter(t=>t[0]==='poster'||E.type===t[0]).map(t=>
      `<button type="button" class="tp ${E.type===t[0]?'on':''}" data-t="${t[0]}"><b>${t[1]}</b><span>${t[2]}</span></button>`).join('')}
    </div></div>
  <div class="aform">
    <div class="fld full"><label>Product name *</label><input id="e_name" value="${esc(E.name)}" placeholder="e.g. MIDNIGHT DRIVE — Poster Set"></div>
    <div class="fld"><label>URL slug (auto if empty)</label><input id="e_slug" value="${esc(E.slug)}" placeholder="midnight-drive"></div>
    <div class="fld"><label>Set number</label><input id="e_setno" value="${esc(E.setNo)}" placeholder="21"></div>
    <div class="fld full"><label>Tagline</label><input id="e_short" value="${esc(E.short)}" placeholder="e.g. after-hours anthems for your walls"></div>
    <div class="fld full"><label>Description</label><textarea id="e_desc" rows="4">${esc(E.description)}</textarea></div>
    <div class="fld"><label>Price ৳ *</label><input id="e_price" type="number" min="1" value="${E.price}"></div>
    <div class="fld"><label>Sale price ৳ (empty = no sale)</label><input id="e_sale" type="number" min="1" value="${E.salePrice}"></div>
    <div class="fld" id="stockfld"><label>Stock *</label><input id="e_stock" type="number" min="0" value="${E.stock}"></div>
    <div class="fld"><label>SKU</label><input id="e_sku" value="${esc(E.sku)}" placeholder="HSS-SET-21"></div>
    <div class="fld"><label>Sort order</label><input id="e_sort" type="number" value="${E.sort}"></div>
    <div class="fld"><label>Tags (comma separated)</label><input id="e_tags" value="${esc(E.tags)}" placeholder="pink, y2k, coquette"></div>
    <div class="fld full"><label>Categories</label><div class="arow">${A.cats.map(c=>`<label style="display:inline-flex;align-items:center;gap:7px;text-transform:none;font-size:14px;color:var(--ink);border:1px solid var(--line2);border-radius:99px;padding:8px 16px"><input type="checkbox" class="ecat" value="${c.id}" ${E.categoryIds.includes(c.id)?'checked':''} style="width:auto"> ${esc(c.name)}</label>`).join('')}</div></div>
    <div class="fld full" id="sizeblock" style="display:none"><label>Available sizes & stock *</label>
      <div id="sizerows"></div>
      <div class="arow" style="margin-top:8px">
        <button type="button" class="abtn ghost sm" onclick="SZADD()">+ Add size</button>
        <button type="button" class="abtn ghost sm" onclick="SZPRESET()">Use S–XXL preset</button>
      </div></div>
    <div class="fld full" id="bundleblock" style="display:none"><label>Items included in this bundle *</label>
      <div id="bundlerows"></div>
      <button type="button" class="abtn ghost sm" style="margin-top:8px" onclick="BIADD()">+ Add item</button></div>
    <div class="fgrid2 full" id="posterspec" style="display:none;gap:16px">
      <div class="fld"><label>Poster size</label><input id="e_psize" value="${esc(E.posterSize)}" placeholder="A4"></div>
      <div class="fld"><label>Board thickness</label><input id="e_board" value="${esc(E.boardThickness)}" placeholder="3mm"></div>
    </div>
    <div class="fld full"><label>Cover image * (square-ish banner shown on cards)</label><div class="coverup" id="coverbox"><span>Click to upload cover</span><input type="file" id="e_coverf" accept="image/*"></div></div>
    <div class="fld full" id="gallabel"><label>The 6 posters * (drag order with ← → buttons)</label><div class="upslots" id="pslots"></div>
      <div class="arow" style="margin-top:10px"><label class="abtn ghost sm" style="cursor:pointer">+ Add images<input type="file" id="e_postf" accept="image/*" multiple hidden></label><span style="font-size:13px;color:var(--mut)" id="pcount"></span></div></div>
    <div class="fld full"><div class="panel" style="padding:6px 20px">
      ${[['featured','Featured','Shows in Featured rail + can be homepage-picked'],['isNew','New In','Shows NEW badge + New Arrivals'],['bestseller','Bestseller','Shows BESTSELLER badge'],['published','Published','Visible in the store'],['allowBackorder','Allow backorder','Let customers order even at 0 stock']].map(f=>`
      <div class="switchrow"><div><b>${f[1]}</b><span>${f[2]}</span></div><label class="tgl"><input type="checkbox" id="e_${f[0]}" ${E[f[0]]?'checked':''}><i></i></label></div>`).join('')}
    </div></div>
    <div class="fld"><label>SEO title (optional)</label><input id="e_seot" value="${esc(E.seoTitle)}"></div>
    <div class="fld"><label>SEO description (optional)</label><input id="e_seod" value="${esc(E.seoDesc)}"></div>
  </div>
  <div class="arow" style="margin:20px 0 40px"><button class="abtn lime" style="padding:14px 34px" onclick="ESAVE()">${P?'Save changes':'Publish set'} →</button><button class="abtn ghost" onclick="GOTAB('products')">Cancel</button></div>`;

  function drawCover(){ const b=document.getElementById('coverbox');
    b.innerHTML=`${E.cover?`<img src="${esc(E.cover)}">`:''}<span style="${E.cover?'position:absolute;bottom:10px;background:rgba(11,11,15,.8);padding:6px 16px;border-radius:99px;font-size:12.5px':''}">${E.cover?'Replace cover':'Click to upload cover'}</span><input type="file" id="e_coverf" accept="image/*">`;
    document.getElementById('e_coverf').onchange=async e=>{ if(!e.target.files.length)return; toast('Uploading…');
      try{ const u=await uploadFiles(e.target.files); E.cover=u[0]; drawCover(); toast('Cover uploaded',true);}catch(err){toast(err.message);} };
  }
  function drawSlots(){ const s=document.getElementById('pslots');
    document.getElementById('pcount').textContent = E.type==='poster'
      ? E.posters.length+'/6 posters'+(E.posters.length!==6?' — need exactly 6':' ✓')
      : E.posters.length+' gallery image(s)';
    s.innerHTML=E.posters.map((u,i)=>`<div class="upslot"><span class="num">${i+1}</span><img src="${esc(u)}"><span class="ctl"><button onclick="PMV(${i},-1)">←</button><button onclick="PMV(${i},1)">→</button><button onclick="PRM(${i})">✕</button></span></div>`).join('')
      + (E.posters.length<(E.type==='poster'?8:10)?`<label class="upslot" style="cursor:pointer">+ Upload<br>posters<input type="file" id="e_postf2" accept="image/*" multiple></label>`:'');
    const f2=document.getElementById('e_postf2'); if(f2) f2.onchange=addP;
    window.PMV=(i,d)=>{ const j=i+d; if(j<0||j>=E.posters.length)return; [E.posters[i],E.posters[j]]=[E.posters[j],E.posters[i]]; drawSlots(); };
    window.PRM=i=>{ E.posters.splice(i,1); drawSlots(); };
  }
  async function addP(e){ if(!e.target.files.length)return; toast('Uploading…');
    try{ const u=await uploadFiles(e.target.files); E.posters=[...E.posters,...u].slice(0,E.type==='poster'?8:10); drawSlots(); toast('Uploaded',true);}catch(err){toast(err.message);} }
  function drawSizes(){
    const box=document.getElementById('sizerows');
    box.innerHTML=E.sizes.map((x,i)=>`<div class="szrow">
      <input value="${esc(x.size)}" placeholder="Size (M)" oninput="SZSET(${i},'size',this.value)">
      <input type="number" min="0" value="${x.stock}" placeholder="Stock" oninput="SZSET(${i},'stock',this.value)">
      <button type="button" class="abtn sm danger" onclick="SZRM(${i})">✕</button></div>`).join('')
      || '<p class="asub">No sizes yet — add at least one.</p>';
    const tot=E.sizes.reduce((t,x)=>t+(parseInt(x.stock)||0),0);
    const sf=document.getElementById('e_stock');
    if(E.type==='clothing'&&E.sizes.length){ sf.value=tot; sf.readOnly=true; } else sf.readOnly=false;
  }
  window.SZSET=(i,k,v)=>{ E.sizes[i][k]= k==='stock'?Math.max(0,parseInt(v)||0):v; if(k==='stock') drawSizes(); };
  window.SZADD=()=>{ E.sizes.push({size:'',stock:0}); drawSizes(); };
  window.SZRM=i=>{ E.sizes.splice(i,1); drawSizes(); };
  window.SZPRESET=()=>{ E.sizes=['S','M','L','XL','XXL'].map(s=>({size:s,stock:10})); drawSizes(); };
  function drawBundle(){
    const box=document.getElementById('bundlerows');
    box.innerHTML=E.bundleItems.map((x,i)=>`<div class="szrow">
      <input value="${esc(x)}" placeholder="e.g. Oversized shirt" oninput="BISET(${i},this.value)" style="flex:1">
      <button type="button" class="abtn sm danger" onclick="BIRM(${i})">✕</button></div>`).join('')
      || '<p class="asub">Add the items this bundle contains.</p>';
  }
  window.BISET=(i,v)=>{ E.bundleItems[i]=v; };
  window.BIADD=()=>{ E.bundleItems.push(''); drawBundle(); };
  window.BIRM=i=>{ E.bundleItems.splice(i,1); drawBundle(); };
  function applyType(){
    const t=E.type;
    document.getElementById('sizeblock').style.display = (t==='clothing'||t==='combo')?'':'none';
    document.getElementById('bundleblock').style.display = t==='combo'?'':'none';
    document.getElementById('posterspec').style.display = t==='poster'?'grid':'none';
    document.getElementById('gallabel').querySelector('label').textContent =
      t==='poster' ? 'The 6 posters * (reorder with ← →)' : 'Gallery images (up to 10)';
    document.querySelectorAll('#typepick .tp').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
    document.getElementById('pcount').textContent = t==='poster'
      ? E.posters.length+'/6 posters'+(E.posters.length!==6?' — need exactly 6':' ✓')
      : E.posters.length+' gallery image(s)';
    drawSizes(); drawBundle();
  }
  document.querySelectorAll('#typepick .tp').forEach(b=>b.onclick=()=>{ E.type=b.dataset.t; applyType(); });
  drawCover(); drawSlots(); applyType();
  document.getElementById('e_postf').onchange=addP;
  window.ESAVE=async()=>{
    const body={ name:document.getElementById('e_name').value.trim(), slug:document.getElementById('e_slug').value.trim(),
      setNo:document.getElementById('e_setno').value.trim(), short:document.getElementById('e_short').value.trim(),
      description:document.getElementById('e_desc').value.trim(), price:Number(document.getElementById('e_price').value),
      salePrice:document.getElementById('e_sale').value===''?null:Number(document.getElementById('e_sale').value),
      stock:parseInt(document.getElementById('e_stock').value), sku:document.getElementById('e_sku').value.trim(),
      sort:parseInt(document.getElementById('e_sort').value)||0, tags:document.getElementById('e_tags').value,
      categoryIds:[...document.querySelectorAll('.ecat:checked')].map(x=>x.value), cover:E.cover, posters:E.posters,
      featured:document.getElementById('e_featured').checked, isNew:document.getElementById('e_isNew').checked,
      bestseller:document.getElementById('e_bestseller').checked, published:document.getElementById('e_published').checked,
      allowBackorder:document.getElementById('e_allowBackorder').checked,
      type:E.type, sizes:E.sizes.filter(x=>String(x.size).trim()),
      bundleItems:E.bundleItems.filter(x=>String(x).trim()),
      posterSize:document.getElementById('e_psize').value.trim()||'A4',
      boardThickness:document.getElementById('e_board').value.trim()||'3mm',
      seoTitle:document.getElementById('e_seot').value, seoDesc:document.getElementById('e_seod').value };
    try{
      if(P) await api('/api/admin/products/'+P.id,{method:'PUT',body});
      else await api('/api/admin/products',{method:'POST',body});
      toast('Saved',true); GOTAB('products');
    }catch(e){ toast(e.message); }
  };
}

/* ---------- categories ---------- */
async function vCats(pane){
  A.cats=(await api('/api/admin/categories')).categories||[];
  pane.innerHTML=head('Categories','Group sets into vibes & collections')+`
  <div class="panel" style="margin-bottom:18px"><h2>Add category</h2><div class="aform">
    <div class="fld"><label>Name *</label><input id="c_name" placeholder="e.g. Coquette & Pink"></div>
    <div class="fld"><label>Sort order</label><input id="c_sort" type="number" value="${A.cats.length+1}"></div>
    <div class="fld full"><label>Description</label><input id="c_desc" placeholder="Short line shown on homepage"></div>
  </div><div class="arow" style="margin-top:12px"><button class="abtn lime" onclick="CADD()">Add category</button></div></div>
  <div class="panel"><table class="atable"><thead><tr><th>Name</th><th>Sets</th><th>Sort</th><th>Visible</th><th></th></tr></thead><tbody>
  ${A.cats.map(c=>`<tr><td><b>${esc(c.name)}</b><br><span style="color:var(--dim);font-size:12.5px">${esc(c.description||'')}</span></td><td>${c.productCount}</td>
    <td><input type="number" value="${c.sort}" style="width:70px;padding:7px" onchange="CEDIT('${c.id}',{sort:+this.value})"></td>
    <td><label class="tgl"><input type="checkbox" ${c.visible!==false?'checked':''} onchange="CEDIT('${c.id}',{visible:this.checked})"><i></i></label></td>
    <td><div class="arow"><button class="abtn sm ghost" onclick="CED('${c.id}')">Edit</button><button class="abtn sm danger" onclick="CDEL('${c.id}')">Delete</button></div></td></tr>`).join('')}
  </tbody></table></div><div id="cedit"></div>`;
  window.CED=id=>{ const c=A.cats.find(x=>x.id===id); const box=document.getElementById('cedit');
    box.innerHTML=`<div class="panel" style="margin-top:18px"><h2>Edit category — ${esc(c.name)}</h2><div class="aform">
      <div class="fld"><label>Name *</label><input id="ce_name" value="${esc(c.name)}"></div>
      <div class="fld"><label>Link</label><input value="/shop?cat=${esc(c.id)}" readonly></div>
      <div class="fld full"><label>Description (shown on the shop page for this category)</label><input id="ce_desc" value="${esc(c.description||'')}"></div>
      <div class="fld full"><label>Tile image for the homepage "Shop by vibe" row (empty = artwork from a set in this category)</label>
        <div class="arow"><input id="ce_img" value="${esc(c.image||'')}" style="flex:1"><label class="abtn ghost sm" style="cursor:pointer">Upload<input type="file" id="ce_imgf" accept="image/*" hidden></label></div>
        ${c.image?`<img src="${esc(c.image)}" style="max-width:160px;border-radius:10px;margin-top:10px">`:''}</div>
    </div><div class="arow" style="margin-top:12px"><button class="abtn lime" id="ce_save">Save category</button><button class="abtn ghost" onclick="document.getElementById('cedit').innerHTML=''">Cancel</button></div></div>`;
    document.getElementById('ce_imgf').onchange=async e=>{ if(!e.target.files.length)return; toast('Uploading…');
      try{ const u=await uploadFiles(e.target.files); document.getElementById('ce_img').value=u[0]; toast('Uploaded — press Save',true);}catch(err){toast(err.message);} };
    document.getElementById('ce_save').onclick=()=>{ const n=document.getElementById('ce_name').value.trim(); if(!n) return toast('Name is required');
      CEDIT(id,{name:n,description:document.getElementById('ce_desc').value,image:document.getElementById('ce_img').value.trim()}); };
    box.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.CADD=async()=>{ try{await api('/api/admin/categories',{method:'POST',body:{name:document.getElementById('c_name').value,description:document.getElementById('c_desc').value,sort:+document.getElementById('c_sort').value}});toast('Added',true);vCats(pane);}catch(e){toast(e.message);} };
  window.CEDIT=async(id,b)=>{ try{await api('/api/admin/categories/'+id,{method:'PUT',body:b});toast('Saved',true);vCats(pane);}catch(e){toast(e.message);} };
  window.CREN=async id=>{ const c=A.cats.find(x=>x.id===id); const n=prompt('Rename category:',c.name); if(n&&n.trim()) CEDIT(id,{name:n.trim()}); };
  window.CDEL=async id=>{ const c=A.cats.find(x=>x.id===id); if(!confirm(`Delete "${c.name}"? Sets will be unassigned, not deleted.`))return; try{await api('/api/admin/categories/'+id,{method:'DELETE'});toast('Deleted',true);vCats(pane);}catch(e){toast(e.message);} };
}

/* ---------- customers ---------- */
async function vCustomers(pane){
  A.customers=(await api('/api/admin/customers')).customers;
  pane.innerHTML=head('Customers',A.customers.length+' registered account(s)')+`
  <div class="panel"><table class="atable"><thead><tr><th>Name</th><th>Mobile</th><th>Address</th><th>Orders</th><th>Spent</th><th>Joined</th><th></th></tr></thead><tbody>
  ${A.customers.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.mobile)}</td><td style="font-size:13px">${esc(c.address||'—')}</td><td>${c.orders}</td><td>${money(c.spent)}</td><td style="font-size:13px">${new Date(c.createdAt).toLocaleDateString()}</td><td><button class="abtn ghost sm" data-reset="${esc(c.id)}" title="Only after the customer messaged you from this number">🔑 Reset code</button></td></tr>`).join('')||'<tr><td colspan="7">No customer accounts yet.</td></tr>'}
  </tbody></table><p style="color:var(--dim);font-size:13px;margin-top:10px">Guest orders (no account) still appear under Orders.</p>
  <p style="color:var(--dim);font-size:13px">🔑 <b>Password resets:</b> only generate a code after the customer has messaged you on WhatsApp <b>from their registered number</b>. The code works once, for 30 minutes.</p>
  <div id="resetbox"></div></div>`;
  pane.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{
    const c=A.customers.find(x=>x.id===b.dataset.reset); if(!c) return;
    if(!confirm(`Generate a password reset code for ${c.name} (${c.mobile})?\n\nOnly do this if they messaged you from ${c.mobile}.`)) return;
    try{
      const d=await api('/api/admin/customers/'+encodeURIComponent(c.id)+'/reset-code',{method:'POST'});
      document.getElementById('resetbox').innerHTML=`<div class="panel" style="margin-top:12px">
        <b>Reset code for ${esc(c.name)} (${esc(d.mobile)}):</b>
        <div style="font-size:26px;font-weight:800;letter-spacing:.15em;margin:8px 0">${esc(d.code)}</div>
        <p style="color:var(--dim);font-size:13px;margin:0 0 10px">Valid ${d.validMinutes} minutes, single use. Send it only to ${esc(d.mobile)}.</p>
        <a class="abtn" href="${esc(d.whatsappUrl)}" target="_blank" rel="noopener">Send on WhatsApp</a></div>`;
    }catch(e){ toast(e.message||'Could not create a reset code'); }
  });
}

/* ---------- homepage CMS ---------- */
async function vHome(pane){
  const d=await api('/api/admin/homepage');
  A.homepage=d.homepage||{}; A.products=d.products||[]; const cats=d.categories||[];
  const Hh=A.homepage;
  const byId=Object.fromEntries(A.products.map(p=>[p.id,p]));
  const S={ featured:[...(Hh.featuredIds||[])], news:[...(Hh.newIds||[])], best:[...(Hh.bestsellerIds||[])] };
  const Hb=(Hh.hero&&Hh.hero.blocks)||{}; const HS=Hb.sections||{};
  const perks=(Hb.perks&&Hb.perks.length?Hb.perks:[]).concat(Array(6).fill({title:'',text:''})).slice(0,6);
  pane.innerHTML=head('Homepage CMS','Everything on the homepage — no code needed. Empty fields use the built-in poster-shop wording.')+`
  <div class="arow" style="margin-bottom:14px"><button class="abtn ghost" onclick="HRECO()">✨ Fill with recommended poster-shop copy</button>
    <a class="abtn ghost" href="/" target="_blank" rel="noopener">Open homepage ↗</a></div>
  <div class="panel" style="margin-bottom:18px"><h2>Hero section</h2><div class="aform">
    <div class="fld"><label>Badge (small pill above the headline)</label><input id="h_badge" value="${esc(Hh.hero.badge||'')}" placeholder="e.g. NEW DROP • LIVE NOW"></div>
    <div class="fld"><label>Hero image (empty = default poster collage)</label><div class="arow"><input id="h_img" value="${esc(Hh.hero.image&&Hh.hero.image!=='/images/hero-collage.png'?Hh.hero.image:'')}" style="flex:1"><label class="abtn ghost sm" style="cursor:pointer">Upload<input type="file" id="h_imgf" accept="image/*" hidden></label></div></div>
    <div class="fld"><label>Headline line 1</label><input id="h_l1t" value="${esc(Hh.hero.line1||'')}" placeholder="SIX POSTERS."></div>
    <div class="fld"><label>Headline line 2</label><input id="h_l2t" value="${esc(Hh.hero.line2||'')}" placeholder="ONE VIBE."></div>
    <div class="fld"><label>Headline line 3</label><input id="h_l3t" value="${esc(Hh.hero.line3||'')}" placeholder="YOUR"></div>
    <div class="fld"><label>Headline line 3 — italic ending</label><input id="h_l3i" value="${esc(Hh.hero.line3Italic||'')}" placeholder="walls."></div>
    <div class="fld full"><label>Subtitle</label><input id="h_sub" value="${esc(Hh.hero.subtitle||'')}"></div>
    <div class="fld"><label>Tagline under subtitle</label><input id="h_tag" value="${esc(Hh.hero.tagline||'')}" placeholder="A4 • 3MM BOARD • 6 POSTERS PER SET"></div>
    <div class="fld"><label>Strip at bottom of hero</label><input id="h_strip" value="${esc(Hh.hero.strip||'')}" placeholder="PREMIUM A4 POSTER SETS • 3MM BOARD"></div>
    <div class="fld"><label>Button 1 text</label><input id="h_c1" value="${esc(Hh.hero.ctaText||'')}"></div>
    <div class="fld"><label>Button 1 link</label><input id="h_l1" value="${esc(Hh.hero.ctaLink||'')}"></div>
    <div class="fld"><label>Button 2 text</label><input id="h_c2" value="${esc(Hh.hero.cta2Text||'')}"></div>
    <div class="fld"><label>Button 2 link</label><input id="h_l2" value="${esc(Hh.hero.cta2Link||'')}"></div>
  </div></div>
  ${[['featured','⭐ Featured sets'],['news','✨ New arrivals'],['best','🔥 Best sellers']].map(s=>`
  <div class="panel" style="margin-bottom:18px"><h2>${s[1]} <span style="color:var(--dim);font-size:13px" id="cnt_${s[0]}"></span></h2>
    <div class="aform"><div class="fld"><label>Add a set</label><input id="q_${s[0]}" placeholder="Search sets…" style="margin-bottom:8px"><div class="picklist" id="av_${s[0]}"></div></div>
    <div class="fld"><label>Showing on homepage (top = first)</label><div class="picklist" id="ch_${s[0]}"></div></div></div>
  </div>`).join('')}
  <div class="panel" style="margin-bottom:18px"><h2>Scrolling marquee</h2>
    <div class="fld"><label>One message per line (up to 8)</label><textarea id="h_marq" rows="4" placeholder="NATIONWIDE DELIVERY">${esc((Hb.marquee||[]).join('\n'))}</textarea></div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Section headings</h2><div class="aform">
    ${[['new','New arrivals'],['best','Best sellers'],['featured','Featured'],['collections','Collections (shop by vibe)']].map(([k,l])=>`
    <div class="fld"><label>${l} — title</label><input id="hs_${k}_t" value="${esc((HS[k]||{}).title||'')}"></div>
    <div class="fld"><label>${l} — subtitle</label><input id="hs_${k}_s" value="${esc((HS[k]||{}).sub||'')}"></div>`).join('')}
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Perks (why buy from us)</h2><div class="aform">
    ${perks.map((p,i)=>`<div class="fld"><label>Perk ${i+1} title</label><input id="hp_${i}_t" value="${esc(p.title||'')}"></div>
    <div class="fld"><label>Perk ${i+1} text</label><input id="hp_${i}_x" value="${esc(p.text||'')}"></div>`).join('')}
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Instagram block</h2><div class="aform">
    <div class="fld"><label>Title</label><input id="hi_t" value="${esc((Hb.insta||{}).title||'')}" placeholder="Follow the society"></div>
    <div class="fld"><label>Text</label><input id="hi_x" value="${esc((Hb.insta||{}).text||'')}"></div>
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Collections row</h2><div class="arow">
    ${cats.map(c=>`<label style="display:inline-flex;align-items:center;gap:7px;font-size:14px;border:1px solid var(--line2);border-radius:99px;padding:8px 16px"><input type="checkbox" class="hcat" value="${c.id}" ${(Hh.collectionCategoryIds||[]).includes(c.id)?'checked':''} style="width:auto"> ${esc(c.name)}</label>`).join('')}
  </div><div class="fld" style="margin-top:12px"><label>Perks section title</label><input id="h_perks" value="${esc(Hh.perksTitle||'')}"></div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Visible sections</h2>
    ${[['hero','Hero banner'],['gallery','3D poster gallery'],['marquee','Marquee strip'],['new','New arrivals'],['best','Best sellers'],['featured','Featured'],['collections','Collections'],['perks','Perks'],['insta','Instagram CTA']].map(x=>`
    <div class="switchrow"><div><b>${x[1]}</b></div><label class="tgl"><input type="checkbox" id="sec_${x[0]}" ${(Hh.showSections||{})[x[0]]!==false?'checked':''}><i></i></label></div>`).join('')}
  </div>
  <button class="abtn lime" style="padding:14px 34px;margin-bottom:40px" onclick="HSAVE()">Save homepage →</button>`;

  document.getElementById('h_imgf').onchange=async e=>{ if(!e.target.files.length)return; try{const u=await uploadFiles(e.target.files);document.getElementById('h_img').value=u[0];toast('Uploaded',true);}catch(err){toast(err.message);} };
  ['featured','news','best'].forEach(k=>{
    const drawAv=q=>{ document.getElementById('av_'+k).innerHTML=A.products.filter(p=>!S[k].includes(p.id)&&(!q||p.name.toLowerCase().includes(q.toLowerCase()))).slice(0,30).map(p=>`
      <div class="pickitem"><img src="${esc(p.cover)}" onerror="this.src='/images/logo.png'"><b>${esc(p.name)}${p.published?'':' (hidden)'}</b><button onclick="HADD('${k}','${p.id}')">+ Add</button></div>`).join('')||'<p style="color:var(--dim);font-size:13px">No more sets.</p>'; };
    const drawCh=()=>{ document.getElementById('cnt_'+k).textContent='('+S[k].length+')';
      document.getElementById('ch_'+k).innerHTML=S[k].map((id,i)=>{const p=byId[id];if(!p)return '';return `
      <div class="pickitem"><img src="${esc(p.cover)}" onerror="this.src='/images/logo.png'"><b>${esc(p.name)}</b><button onclick="HMV('${k}',${i},-1)">↑</button><button onclick="HMV('${k}',${i},1)">↓</button><button onclick="HRM('${k}','${id}')">✕</button></div>`;}).join('')||'<p style="color:var(--dim);font-size:13px">Empty — add sets from the left.</p>'; };
    drawAv(''); drawCh();
    document.getElementById('q_'+k).oninput=e=>drawAv(e.target.value);
    window.HADD=(kk,id)=>{S[kk].push(id);vHomeRefresh();};
    window.HRM=(kk,id)=>{S[kk]=S[kk].filter(x=>x!==id);vHomeRefresh();};
    window.HMV=(kk,i,d)=>{const j=i+d;if(j<0||j>=S[kk].length)return;[S[kk][i],S[kk][j]]=[S[kk][j],S[kk][i]];vHomeRefresh();};
    window.vHomeRefresh=()=>{ // redraw pickers without losing hero inputs
      ['featured','news','best'].forEach(k2=>{ const q=document.getElementById('q_'+k2).value;
        document.getElementById('av_'+k2); drawAvK(k2,q); drawChK(k2); });
      function drawAvK(k2,q){ document.getElementById('av_'+k2).innerHTML=A.products.filter(p=>!S[k2].includes(p.id)&&(!q||p.name.toLowerCase().includes(q.toLowerCase()))).slice(0,30).map(p=>`
        <div class="pickitem"><img src="${esc(p.cover)}" onerror="this.src='/images/logo.png'"><b>${esc(p.name)}</b><button onclick="HADD('${k2}','${p.id}')">+ Add</button></div>`).join('')||'<p style="color:var(--dim);font-size:13px">No more sets.</p>'; }
      function drawChK(k2){ document.getElementById('cnt_'+k2).textContent='('+S[k2].length+')';
        document.getElementById('ch_'+k2).innerHTML=S[k2].map((id,i)=>{const p=byId[id];if(!p)return '';return `
        <div class="pickitem"><img src="${esc(p.cover)}" onerror="this.src='/images/logo.png'"><b>${esc(p.name)}</b><button onclick="HMV('${k2}',${i},-1)">↑</button><button onclick="HMV('${k2}',${i},1)">↓</button><button onclick="HRM('${k2}','${id}')">✕</button></div>`;}).join('')||'<p style="color:var(--dim);font-size:13px">Empty.</p>'; }
    };
  });
  const g=id=>document.getElementById(id);
  window.HRECO=()=>{
    const R={h_badge:'NEW SETS • LIVE NOW',h_l1t:'SIX POSTERS.',h_l2t:'ONE VIBE.',h_l3t:'YOUR',h_l3i:'walls.',
      h_sub:'Premium A4 poster sets on 3mm board: six matching designs, ready to hang. Delivered all over Bangladesh.',
      h_tag:'A4 • 3MM BOARD • 6 POSTERS PER SET',h_strip:'PREMIUM A4 POSTER SETS • 3MM BOARD',
      h_c1:'Shop all sets',h_l1:'/shop',h_c2:'New arrivals',h_l2:'/shop?filter=new',
      h_marq:'NEW SETS EVERY DROP\nNATIONWIDE DELIVERY\n6 POSTERS PER SET\nCASH ON DELIVERY',
      hs_new_t:'New arrivals',hs_new_s:'The latest poster sets, just dropped.',hs_best_t:'Cult favourites',hs_best_s:'The sets everyone is hanging right now.',
      hs_featured_t:'Featured sets',hs_featured_s:'Hand-picked by the HSS crew.',hs_collections_t:'Shop by vibe',hs_collections_s:'Find the wall aesthetic that feels like you.',
      hp_0_t:'Six posters, one set',hp_0_x:'Six matching A4 designs, curated to hang together.',hp_1_t:'3mm premium board',hp_1_x:'Thick, rigid and durable. No frames needed.',
      hp_2_t:'Delivered all over BD',hp_2_x:'Every district and thana. Cash on delivery available.',hp_3_t:'Curated themed drops',hp_3_x:'Anime, football, Marvel, music, motorsport and more.',
      hp_4_t:'',hp_4_x:'',hp_5_t:'',hp_5_x:'',hi_t:'Follow the society',hi_x:'New drops, room inspo & behind-the-scenes, first on Instagram.',h_perks:'Why Highstreet Society'};
    Object.entries(R).forEach(([k,v])=>{ const e=g(k); if(e) e.value=v; });
    toast('Recommended copy filled in — review it, then press Save homepage',true);
  };
  window.HSAVE=async()=>{
    const blocks={ marquee:g('h_marq').value.split('\n').map(x=>x.trim()).filter(Boolean),
      sections:Object.fromEntries(['new','best','featured','collections'].map(k=>[k,{title:g('hs_'+k+'_t').value,sub:g('hs_'+k+'_s').value}])),
      perks:[0,1,2,3,4,5].map(i=>({title:g('hp_'+i+'_t').value,text:g('hp_'+i+'_x').value})).filter(p=>p.title.trim()),
      insta:{title:g('hi_t').value,text:g('hi_x').value} };
    const body={ blocks, hero:{badge:g('h_badge').value,line1:g('h_l1t').value,line2:g('h_l2t').value,line3:g('h_l3t').value,line3Italic:g('h_l3i').value,
        tagline:g('h_tag').value,strip:g('h_strip').value,subtitle:g('h_sub').value,
        ctaText:g('h_c1').value,ctaLink:g('h_l1').value,cta2Text:g('h_c2').value,cta2Link:g('h_l2').value,image:g('h_img').value},
      featuredIds:S.featured,newIds:S.news,bestsellerIds:S.best,
      collectionCategoryIds:[...document.querySelectorAll('.hcat:checked')].map(x=>x.value),
      perksTitle:document.getElementById('h_perks').value,
      showSections:{} };
    ['hero','gallery','marquee','new','best','featured','collections','perks','insta'].forEach(k=>body.showSections[k]=document.getElementById('sec_'+k).checked);
    try{ await api('/api/admin/homepage',{method:'PUT',body}); toast('Homepage saved',true); }catch(e){ toast(e.message); }
  };
}

/* ---------- inventory ---------- */
async function vInv(pane){
  A.products=(await api('/api/admin/products')).products||[];
  pane.innerHTML=head('Inventory','Quick stock control')+`
  <div class="panel"><table class="atable"><thead><tr><th>Set</th><th>SKU</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
  ${A.products.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td style="font-size:13px">${esc(p.sku||'—')}</td>
    <td><div class="arow"><button class="abtn sm ghost" onclick="ISTOCK('${p.id}',-1)">−</button><b id="st_${p.id}" style="min-width:34px;text-align:center">${p.stock}</b><button class="abtn sm ghost" onclick="ISTOCK('${p.id}',1)">+</button></div></td>
    <td>${p.stock===0?'<span class="apill r">OUT</span>':p.stock<=5?'<span class="apill y">LOW</span>':'<span class="apill g">OK</span>'}</td>
    <td><button class="abtn sm ghost" onclick="ISET('${p.id}')">Set…</button></td></tr>`).join('')}
  </tbody></table></div>`;
  async function save(p,stock){ try{await api('/api/admin/products/'+p.id,{method:'PUT',body:Object.assign({},p,{tags:(p.tags||[]).join(', '),stock})});p.stock=stock;document.getElementById('st_'+p.id).textContent=stock;vInv(pane);}catch(e){toast(e.message);} }
  window.ISTOCK=(id,d)=>{const p=A.products.find(x=>x.id===id);save(p,Math.max(0,p.stock+d));};
  window.ISET=id=>{const p=A.products.find(x=>x.id===id);const v=prompt('Set stock for '+p.name+':',p.stock);if(v!==null&&!isNaN(+v)&&+v>=0)save(p,Math.floor(+v));};
}

/* ---------- coupons ---------- */
/* ---------- poster exhibition (homepage 3D gallery) ---------- */
async function vExhibit(pane){
  const d=await api('/api/admin/exhibition');
  const X={ enabled:d.enabled, sets:d.sets, open:null, dirty:false };
  // editable copies of poster info / labels
  X.sets.forEach(s=>{ s._label=s.label; s.posters.forEach(p=>{ p._title=p.overridden?p.title:''; p._text=p.overridden?p.text:''; }); });
  const words=t=>String(t||'').trim().split(/\s+/).filter(Boolean).length;
  const descOf=p=>(p._text||p.defaultText||'').trim();
  function mark(){ X.dirty=true; const b=document.getElementById('ex_save'); if(b){ b.textContent='Save changes •'; b.classList.add('lime'); } }
  function draw(){
    let pos=0;
    const vis=X.sets.filter(s=>s.published&&!s.hidden);
    const posters=vis.reduce((n,s)=>n+s.imageCount,0);
    pane.innerHTML=head('🎨 Poster Exhibition','The 3D poster exhibition on the homepage. One slide per set, in the order below. Drag rows (or use ↑ ↓) to reorder. Hiding a set only affects the exhibition: the product, stock and orders are untouched.')+`
    <div class="panel" style="margin-bottom:16px"><div class="switchrow" style="border:0;padding:0"><div><b>Show the exhibition on the homepage</b>
      <span>${vis.length} set(s) and ${posters} poster(s) will be shown. Newly published sets are added automatically at the end.</span></div>
      <label class="tgl"><input type="checkbox" id="ex_on" ${X.enabled?'checked':''}><i></i></label></div></div>
    <div class="arow" style="margin-bottom:14px;position:sticky;top:0;z-index:5;background:var(--bg);padding:8px 0">
      <button class="abtn ${X.dirty?'lime':''}" id="ex_save">${X.dirty?'Save changes •':'Save changes'}</button>
      <a class="abtn ghost" href="/#g3d" target="_blank" rel="noopener">Preview on homepage ↗</a>
      <span class="asub" style="margin:0">${X.dirty?'Unsaved changes — the homepage shows the last saved version.':'All changes saved.'}</span></div>
    <ol class="exlist" id="exlist">${X.sets.map((s,i)=>{
      const status=!s.published?'<span class="apill">NOT PUBLISHED</span>':s.hidden?'<span class="apill r">HIDDEN</span>':'<span class="apill g">VISIBLE</span>';
      const p=s.published&&!s.hidden?++pos:null;
      const noDesc=s.posters.filter(x=>!descOf(x)).length;
      return `<li class="exrow ${p?'':'off'}" draggable="true" data-i="${i}">
        <span class="exgrip" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
        <span class="expos">${p?String(p).padStart(2,'0'):'—'}</span>
        <img src="${esc(H.img(s.cover||(s.posters[0]||{}).url,200))}" alt="" class="athumb" onerror="this.style.visibility='hidden'">
        <div class="exname"><b>${esc(s._label||s.name)}</b>${s._label?`<span class="asub" style="margin:0"> (product: ${esc(s.name)})</span>`:''}
          <span>${esc(s.categories.join(', ')||'No category')} • ${s.imageCount}/6 posters${s.missing?` <b style="color:var(--gold)">⚠ ${s.missing} image(s) missing</b>`:''}
          ${noDesc?` • <b style="color:var(--gold)">⚠ ${noDesc} without description</b>`:' • all described ✓'}</span></div>
        ${status}
        <div class="arow" style="flex-wrap:nowrap">
          <button class="abtn sm ghost" data-mv="-1" aria-label="Move ${esc(s.name)} up">↑</button>
          <button class="abtn sm ghost" data-mv="1" aria-label="Move ${esc(s.name)} down">↓</button>
          ${s.published?`<button class="abtn sm ${s.hidden?'lime':'ghost'}" data-hide>${s.hidden?'Show':'Hide'}</button>`:''}
          <button class="abtn sm ghost" data-open>${X.open===s.id?'Close':'Details'}</button></div>
        ${X.open===s.id?details(s):''}
      </li>`;}).join('')}</ol>
    <p class="asub">Unpublished sets never appear publicly; their position and poster texts are kept for when you publish them again. The shop's own product order is not affected by this list.</p>`;
    wire();
  }
  function details(s){
    return `<div class="exdet" draggable="false">
      <div class="fld" style="max-width:420px"><label>Exhibition label (optional — the product name stays unchanged)</label>
        <input data-label value="${esc(s._label||'')}" placeholder="${esc(s.name)}" maxlength="60"></div>
      ${s.missing?`<p style="color:var(--gold);font-size:13.5px">⚠ This set has ${s.imageCount} poster image(s); ${s.missing} missing. Add them in Products → Edit. The exhibition never duplicates images to fill gaps.</p>`:''}
      <div class="exposters">${s.posters.map((p,j)=>`<div class="expost">
        <a href="${esc(p.url)}" target="_blank" rel="noopener" title="Open the original image"><img src="${esc(H.img(p.url,400))}" alt="Poster ${j+1}"></a>
        <div class="fld"><label>Poster ${j+1} title</label><input data-pt="${j}" value="${esc(p._title)}" placeholder="${esc(p.defaultTitle||'Poster '+(j+1))}" maxlength="60"></div>
        <div class="fld"><label>Short description (8–20 words)</label><textarea data-px="${j}" rows="3" maxlength="180" placeholder="${esc(p.defaultText||'No description yet — write one so visitors see this poster\'s story.')}">${esc(p._text)}</textarea>
          <span class="exwc" data-wc="${j}"></span></div>
        <div class="arow" style="justify-content:space-between">${p.defaultText||p.defaultTitle?`<button class="abtn sm ghost" data-reset="${j}" ${p._title||p._text?'':'disabled'}>Restore default</button>`:'<span class="asub" style="margin:0;font-size:12px">No default text</span>'}
          ${descOf(p)?'':'<b style="color:var(--gold);font-size:12.5px">⚠ Missing description</b>'}</div>
      </div>`).join('')}</div>
      <p class="asub" style="font-size:12.5px">Empty fields use the default text shown in grey. Visitors see the title and description when they hover (desktop) or tap (mobile) a poster.</p></div>`;
  }
  function wcUpdate(row,s){ row.querySelectorAll('[data-wc]').forEach(el=>{ const p=s.posters[+el.dataset.wc]; const t=descOf(p); const n=words(t);
    el.textContent=t?n+' words'+(p._text?'':' (default)'):'';
    el.style.color=t&&(n<8||n>20)?'var(--gold)':'var(--dim)'; }); }
  function wire(){
    document.getElementById('ex_on').onchange=e=>{ X.enabled=e.target.checked; mark(); draw(); };
    document.getElementById('ex_save').onclick=save;
    const list=document.getElementById('exlist');
    list.querySelectorAll('.exrow').forEach(row=>{
      const i=+row.dataset.i, s=X.sets[i];
      row.querySelectorAll('[data-mv]').forEach(b=>b.onclick=()=>{ const j=i+ +b.dataset.mv; if(j<0||j>=X.sets.length) return;
        [X.sets[i],X.sets[j]]=[X.sets[j],X.sets[i]]; mark(); draw(); const nb=document.querySelector(`.exrow[data-i="${j}"] [data-mv="${b.dataset.mv}"]`); if(nb) nb.focus(); });
      const hb=row.querySelector('[data-hide]'); if(hb) hb.onclick=()=>{ s.hidden=!s.hidden; mark(); draw(); };
      row.querySelector('[data-open]').onclick=()=>{ X.open=X.open===s.id?null:s.id; draw(); };
      const det=row.querySelector('.exdet');
      if(det){
        // typing inside the details must not start a drag
        det.addEventListener('mousedown',()=>row.setAttribute('draggable','false'));
        det.addEventListener('mouseup',()=>row.setAttribute('draggable','true'));
        det.querySelector('[data-label]').oninput=e=>{ s._label=e.target.value; mark(); };
        det.querySelectorAll('[data-pt]').forEach(el=>el.oninput=()=>{ s.posters[+el.dataset.pt]._title=el.value; mark(); });
        det.querySelectorAll('[data-px]').forEach(el=>el.oninput=()=>{ s.posters[+el.dataset.px]._text=el.value; mark(); wcUpdate(row,s); });
        det.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>{ const p=s.posters[+b.dataset.reset]; p._title=''; p._text=''; mark(); draw(); });
        wcUpdate(row,s);
      }
      // drag and drop reordering
      row.addEventListener('dragstart',e=>{ if(row.getAttribute('draggable')!=='true'){ e.preventDefault(); return; } e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend',()=>row.classList.remove('dragging'));
      row.addEventListener('dragover',e=>{ e.preventDefault(); const r=row.getBoundingClientRect(); row.classList.toggle('dropafter',e.clientY>r.top+r.height/2); row.classList.toggle('dropbefore',e.clientY<=r.top+r.height/2); });
      row.addEventListener('dragleave',()=>row.classList.remove('dropafter','dropbefore'));
      row.addEventListener('drop',e=>{ e.preventDefault(); const from=+e.dataTransfer.getData('text/plain'); if(isNaN(from)) return;
        const r=row.getBoundingClientRect(); let to=i+(e.clientY>r.top+r.height/2?1:0);
        const [m]=X.sets.splice(from,1); if(from<to) to--; X.sets.splice(to,0,m); mark(); draw(); });
    });
  }
  async function save(){
    const body={ enabled:X.enabled, order:X.sets.map(s=>s.id), hidden:X.sets.filter(s=>s.hidden).map(s=>s.id),
      labels:Object.fromEntries(X.sets.map(s=>[s.id,s._label||''])),
      info:Object.fromEntries(X.sets.map(s=>[s.id,Object.fromEntries(s.posters.map(p=>[p.url,{title:p._title||'',text:p._text||''}]))])) };
    try{ await api('/api/admin/exhibition',{method:'PUT',body}); toast('Exhibition saved — the homepage now uses this order',true); vExhibit(pane); }
    catch(e){ toast(e.message); }
  }
  draw();
}

/* ---------- promotions (scheduled sales) ---------- */
async function vPromos(pane){
  const [d,cd]=await Promise.all([api('/api/admin/promotions'),api('/api/admin/categories')]);
  const cats=cd.categories||[];
  let L=(d.promotions||[]).map(p=>Object.assign({},p));
  const toLocal=ms=>{ if(!ms) return ''; const t=new Date(ms); return new Date(t.getTime()-t.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const fromLocal=s=>s?new Date(s).getTime():null;
  const pill=s=>({running:'<span class="apill g">RUNNING</span>',scheduled:'<span class="apill y">SCHEDULED</span>',ended:'<span class="apill">ENDED</span>',paused:'<span class="apill r">PAUSED</span>'}[s]||'<span class="apill y">NOT SAVED</span>');
  function draw(){
    pane.innerHTML=head('Promotions','Scheduled sales: lower the price of all sets or selected categories for a period. Prices update automatically on the site, in the cart and at checkout.')+`
    <div class="arow" style="margin-bottom:16px"><button class="abtn lime" id="pr_add">➕ New promotion</button><button class="abtn" id="pr_save">Save all promotions</button></div>
    ${L.length?'':'<div class="panel"><p class="asub">No promotions yet. Example: "Eid Sale — 15% off all sets, 1–7 April, banner: EID SALE • 15% OFF ALL SETS".</p></div>'}
    ${L.map((p,i)=>`<div class="panel" style="margin-bottom:16px"><h2>${esc(p.name||'New promotion')} ${pill(p.status)}</h2><div class="aform">
      <div class="fld"><label>Name *</label><input data-k="name" data-i="${i}" value="${esc(p.name||'')}" placeholder="e.g. Eid Sale"></div>
      <div class="fld"><label>Discount</label><div class="arow"><select data-k="type" data-i="${i}" style="max-width:120px"><option value="percent" ${p.type!=='flat'?'selected':''}>% off</option><option value="flat" ${p.type==='flat'?'selected':''}>৳ off</option></select>
        <input data-k="value" data-i="${i}" type="number" min="1" value="${p.value||''}" style="max-width:120px"></div>
        <span class="asub" style="font-size:12.5px">Example: ৳420 → ৳${p.value>0?Math.max(1,Math.round(p.type==='flat'?420-p.value:420*(1-p.value/100))):'…'}</span></div>
      <div class="fld"><label>Starts (empty = now)</label><input data-k="startsAt" data-i="${i}" type="datetime-local" value="${toLocal(p.startsAt)}"></div>
      <div class="fld"><label>Ends (empty = until paused)</label><input data-k="endsAt" data-i="${i}" type="datetime-local" value="${toLocal(p.endsAt)}"></div>
      <div class="fld full"><label>Applies to (none ticked = ALL sets)</label><div class="arow">${cats.map(c=>`<label style="display:inline-flex;align-items:center;gap:7px;font-size:14px;border:1px solid var(--line2);border-radius:99px;padding:7px 14px"><input type="checkbox" data-cat="${esc(c.id)}" data-i="${i}" ${(p.categoryIds||[]).includes(c.id)?'checked':''} style="width:auto"> ${esc(c.name)}</label>`).join('')}</div></div>
      <div class="fld full"><label>Banner text (replaces the announcement bar while running; empty = no banner)</label><input data-k="banner" data-i="${i}" value="${esc(p.banner||'')}" maxlength="140" placeholder="EID SALE • 15% OFF ALL SETS • ENDS 7 APRIL"></div>
      <div class="fld"><div class="switchrow"><div><b>Active</b><span>Turn off to pause without deleting</span></div><label class="tgl"><input type="checkbox" data-k="active" data-i="${i}" ${p.active!==false?'checked':''}><i></i></label></div></div>
      <div class="fld"><button class="abtn danger sm" data-del="${i}">Delete promotion</button></div>
    </div></div>`).join('')}
    <p class="asub">If a set also has its own sale price, customers always get the lower price. Coupons still apply on top at checkout.</p>`;
    pane.querySelectorAll('[data-k]').forEach(el=>el.onchange=()=>{ const p=L[+el.dataset.i], k=el.dataset.k;
      p[k]= k==='active'?el.checked : k==='value'?Number(el.value) : (k==='startsAt'||k==='endsAt')?fromLocal(el.value) : el.value;
      if(k==='value'||k==='type') draw(); });
    pane.querySelectorAll('[data-cat]').forEach(el=>el.onchange=()=>{ const p=L[+el.dataset.i]; const s=new Set(p.categoryIds||[]);
      el.checked?s.add(el.dataset.cat):s.delete(el.dataset.cat); p.categoryIds=[...s]; });
    pane.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(!confirm('Delete this promotion? (Press Save to apply)')) return; L.splice(+b.dataset.del,1); draw(); });
    document.getElementById('pr_add').onclick=()=>{ L.unshift({name:'',type:'percent',value:10,categoryIds:[],startsAt:null,endsAt:null,banner:'',active:true}); draw(); };
    document.getElementById('pr_save').onclick=async()=>{
      try{ await api('/api/admin/promotions',{method:'PUT',body:{promotions:L}}); toast('Promotions saved — prices updated on the site',true); vPromos(pane); }
      catch(e){ toast(e.message); }
    };
  }
  draw();
}

async function vCoupons(pane){
  A.coupons=(await api('/api/admin/coupons')).coupons;
  pane.innerHTML=head('Coupons','Discount codes for campaigns')+`
  <div class="panel" style="margin-bottom:18px"><h2>Create coupon</h2><div class="aform">
    <div class="fld"><label>Code *</label><input id="k_code" placeholder="EID20" style="text-transform:uppercase"></div>
    <div class="fld"><label>Type</label><select id="k_type"><option value="percent">Percent %</option><option value="flat">Flat ৳</option></select></div>
    <div class="fld"><label>Value *</label><input id="k_val" type="number" placeholder="10"></div>
    <div class="fld"><label>Min order ৳</label><input id="k_min" type="number" value="0"></div>
  </div><div class="arow" style="margin-top:12px"><button class="abtn lime" onclick="KADD()">Create coupon</button></div></div>
  <div class="panel"><table class="atable"><thead><tr><th>Code</th><th>Discount</th><th>Min</th><th>Used</th><th>Active</th><th></th></tr></thead><tbody>
  ${A.coupons.map(c=>`<tr><td><b>${esc(c.code)}</b></td><td>${c.type==='percent'?c.value+'%':'৳'+c.value}</td><td>৳${c.minOrder}</td><td>${c.usage||0}</td>
    <td><label class="tgl"><input type="checkbox" ${c.active?'checked':''} onchange="KTOG('${c.code}',this.checked)"><i></i></label></td>
    <td><button class="abtn sm danger" onclick="KDEL('${c.code}')">Delete</button></td></tr>`).join('')||'<tr><td colspan="6">No coupons.</td></tr>'}
  </tbody></table></div>`;
  window.KADD=async()=>{try{await api('/api/admin/coupons',{method:'POST',body:{code:document.getElementById('k_code').value,type:document.getElementById('k_type').value,value:+document.getElementById('k_val').value,minOrder:+document.getElementById('k_min').value}});toast('Created',true);vCoupons(pane);}catch(e){toast(e.message);}};
  window.KTOG=async(code,v)=>{try{await api('/api/admin/coupons/'+code,{method:'PUT',body:{active:v}});toast('Saved',true);}catch(e){toast(e.message);}};
  window.KDEL=async code=>{if(!confirm('Delete '+code+'?'))return;try{await api('/api/admin/coupons/'+code,{method:'DELETE'});toast('Deleted',true);vCoupons(pane);}catch(e){toast(e.message);}};
}

/* ---------- delivery & payments ---------- */
async function vPay(pane){
  const s=(await api('/api/admin/settings')).settings;
  pane.innerHTML=head('Delivery & Payments','Charges, bKash/Nagad, COD')+`
  <div class="panel" style="margin-bottom:18px"><h2>🚚 Delivery charges (৳)</h2><div class="aform">
    <div class="fld"><label>Inside Dhaka label</label><input id="d_il" value="${esc(s.delivery.insideLabel)}"></div>
    <div class="fld"><label>Inside Dhaka charge</label><input id="d_i" type="number" value="${s.delivery.inside}"></div>
    <div class="fld"><label>Outside Dhaka label</label><input id="d_ol" value="${esc(s.delivery.outsideLabel)}"></div>
    <div class="fld"><label>Outside Dhaka charge</label><input id="d_o" type="number" value="${s.delivery.outside}"></div>
    <div class="fld full"><label>Free delivery above ৳ (0 = off)</label><input id="d_f" type="number" value="${s.delivery.freeAbove}"></div>
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>💵 Payments</h2>
    <div class="switchrow"><div><b>Cash on Delivery</b></div><label class="tgl"><input type="checkbox" id="p_cod" ${s.payments.cod.enabled?'checked':''}><i></i></label></div>
    ${['bkash','nagad'].map(k=>{const t=s.payments[k];return `
    <div class="switchrow"><div><b style="text-transform:capitalize">${k}</b><span>Manual Send Money + TrxID verification</span></div><label class="tgl"><input type="checkbox" id="p_${k}_e" ${t.enabled?'checked':''}><i></i></label></div>
    <div class="aform" style="margin:10px 0 16px"><div class="fld"><label>${k} number</label><input id="p_${k}_n" value="${esc(t.number)}"></div>
    <div class="fld"><label>Account type</label><input id="p_${k}_t" value="${esc(t.accountType)}"></div>
    <div class="fld full"><label>Instruction for customers</label><input id="p_${k}_i" value="${esc(t.instruction)}"></div></div>`;}).join('')}
  </div>
  <button class="abtn lime" style="padding:14px 34px;margin-bottom:40px" onclick="PSAVE()">Save →</button>`;
  window.PSAVE=async()=>{
    try{await api('/api/admin/settings',{method:'PUT',body:{delivery:{insideLabel:document.getElementById('d_il').value,inside:+document.getElementById('d_i').value,outsideLabel:document.getElementById('d_ol').value,outside:+document.getElementById('d_o').value,freeAbove:+document.getElementById('d_f').value},
      payments:{cod:{enabled:document.getElementById('p_cod').checked},bkash:{enabled:document.getElementById('p_bkash_e').checked,number:document.getElementById('p_bkash_n').value,accountType:document.getElementById('p_bkash_t').value,instruction:document.getElementById('p_bkash_i').value},nagad:{enabled:document.getElementById('p_nagad_e').checked,number:document.getElementById('p_nagad_n').value,accountType:document.getElementById('p_nagad_t').value,instruction:document.getElementById('p_nagad_i').value}}}});
      toast('Saved',true);}catch(e){toast(e.message);}
  };
}

/* ---------- settings ---------- */
async function vSettings(pane){
  const s=(await api('/api/admin/settings')).settings;
  pane.innerHTML=head('Settings','Brand, contact, SEO, admin')+`
  <div class="panel" style="margin-bottom:18px"><h2>Brand</h2><div class="aform">
    <div class="fld"><label>Name</label><input id="s_bn" value="${esc(s.brand.name)}"></div>
    <div class="fld"><label>EST</label><input id="s_be" value="${esc(s.brand.est)}"></div>
    <div class="fld full"><label>Tagline (shown in the footer of every page)</label><input id="s_bt" value="${esc(s.brand.tagline)}">
      <span class="asub" style="font-size:12.5px">Suggestion for a poster shop: "Wall culture, six posters at a time" <button type="button" class="abtn ghost sm" onclick="document.getElementById('s_bt').value='Wall culture, six posters at a time'">Use</button></span></div>
    <div class="fld full"><label>Announcement bar</label><input id="s_an" value="${esc(s.announcement)}"></div>
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>Contact & socials</h2><div class="aform">
    <div class="fld"><label>Mobile</label><input id="s_cm" value="${esc(s.contact.mobile)}"></div>
    <div class="fld"><label>WhatsApp</label><input id="s_cw" value="${esc(s.contact.whatsapp)}"></div>
    <div class="fld"><label>Email (optional)</label><input id="s_ce" value="${esc(s.contact.email)}"></div>
    <div class="fld"><label>Location</label><input id="s_ca" value="${esc(s.contact.address)}"></div>
    <div class="fld"><label>Instagram URL</label><input id="s_ci" value="${esc(s.contact.instagram)}"></div>
    <div class="fld"><label>Facebook URL</label><input id="s_cf" value="${esc(s.contact.facebook)}"></div>
  </div></div>
  <div class="panel" style="margin-bottom:18px"><h2>SEO</h2><div class="aform">
    <div class="fld full"><label>Site title</label><input id="s_st" value="${esc(s.seo.title)}"></div>
    <div class="fld full"><label>Site description</label><input id="s_sd" value="${esc(s.seo.description)}"></div>
    <div class="fld"><label>Low-stock alert at</label><input id="s_ls" type="number" value="${s.lowStockAt}"></div>
  </div></div>
  <div class="arow" style="margin-bottom:26px"><button class="abtn lime" style="padding:14px 34px" onclick="SSAVE()">Save settings →</button></div>
  <div class="panel"><h2>🔐 Admin login & password</h2><div class="aform">
    <div class="fld"><label>Admin username</label><input id="a_usr" value="${esc(s.admin&&s.admin.username||'hssadmin')}"></div>
    <div class="fld"><label>Current password *</label><input id="a_cur" type="password" autocomplete="current-password"></div>
    <div class="fld"><label>New password (min 6, leave blank to keep)</label><input id="a_new" type="password" autocomplete="new-password"></div>
  </div><div class="arow" style="margin-top:12px"><button class="abtn" onclick="APW()">Change password</button></div></div>`;
  window.SSAVE=async()=>{try{await api('/api/admin/settings',{method:'PUT',body:{brand:{name:document.getElementById('s_bn').value,est:document.getElementById('s_be').value,tagline:document.getElementById('s_bt').value},announcement:document.getElementById('s_an').value,contact:{mobile:document.getElementById('s_cm').value,whatsapp:document.getElementById('s_cw').value,email:document.getElementById('s_ce').value,address:document.getElementById('s_ca').value,instagram:document.getElementById('s_ci').value,facebook:document.getElementById('s_cf').value},seo:{title:document.getElementById('s_st').value,description:document.getElementById('s_sd').value},lowStockAt:+document.getElementById('s_ls').value}});toast('Saved',true);}catch(e){toast(e.message);}};
  window.APW=async()=>{try{
    const d=await api('/api/admin/password',{method:'POST',body:{
      currentPassword:document.getElementById('a_cur').value,
      newPassword:document.getElementById('a_new').value,
      username:document.getElementById('a_usr').value.trim()}});
    document.getElementById('a_cur').value='';document.getElementById('a_new').value='';
    if(d.reloginRequired){ toast('Password changed — please log in again',true);
      setTimeout(()=>{HSS.store.remove('hss_admin_token');location.reload();},1200); }
    else toast('Admin username updated',true);
  }catch(e){toast(e.message);}};
}


/* ---------- analytics ---------- */
async function vAnalytics(pane){
  const d=await api('/api/admin/analytics?days=30');
  const max=Math.max(1,...d.series.map(s=>s.revenue));
  const bars=d.series.map(s=>`<div class="bar" title="${s.date}: ${money(s.revenue)} (${s.orders} orders)"><i style="height:${Math.round((s.revenue/max)*100)}%"></i></div>`).join('');
  const t=d.totals;
  pane.innerHTML=`${head('ANALYTICS','Revenue, demand and delivery insight for the last 30 days')}
  <div class="kpis">
    ${kpi('Total Revenue',money(t.revenue),'All non-cancelled orders')}
    ${kpi('Avg Order Value',money(t.aov),'Per order')}
    ${kpi('Delivered Revenue',money(t.deliveredRevenue),t.delivered+' delivered orders')}
    ${kpi('Cancelled',t.cancelled,'Orders cancelled')}
  </div>
  <div class="panel" style="margin-bottom:18px"><h2>Revenue — last 30 days</h2>
    ${d.series.some(s=>s.revenue)?`<div class="chart">${bars}</div>
    <div class="chartx"><span>${d.series[0].date}</span><span>${d.series[d.series.length-1].date}</span></div>`
    :`<p class="asub">No revenue in this period yet. Charts appear as soon as orders come in.</p>`}
  </div>
  <div class="acols2">
    <div class="panel"><h2>Top selling sets</h2>
      ${d.topProducts.length?`<table class="atable"><thead><tr><th>Set</th><th>Sold</th><th>Revenue</th></tr></thead><tbody>
      ${d.topProducts.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${money(p.revenue)}</td></tr>`).join('')}
      </tbody></table>`:'<p class="asub">No sales yet.</p>'}
    </div>
    <div class="panel"><h2>Where your orders come from</h2>
      ${d.topDistricts.length?`<table class="atable"><thead><tr><th>District</th><th>Orders</th></tr></thead><tbody>
      ${d.topDistricts.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}</td></tr>`).join('')}
      </tbody></table>
      <p class="asub" style="margin-top:10px">Inside Dhaka: <b>${d.byZone.inside||0}</b> • Outside Dhaka: <b>${d.byZone.outside||0}</b></p>`
      :'<p class="asub">No orders yet.</p>'}
    </div>
  </div>
  <div class="acols2" style="margin-top:18px">
    <div class="panel"><h2>Orders by status</h2>${Object.keys(d.byStatus).length?Object.entries(d.byStatus).map(([k,v])=>`<div class="lrow"><span>${H.statusPill(k)}</span><b>${v}</b></div>`).join(''):'<p class="asub">No orders yet.</p>'}</div>
    <div class="panel"><h2>Payment methods</h2>${Object.keys(d.byPayment).length?Object.entries(d.byPayment).map(([k,v])=>`<div class="lrow"><span>${esc(k.toUpperCase())}</span><b>${v}</b></div>`).join(''):'<p class="asub">No orders yet.</p>'}</div>
  </div>`;
}
function kpi(l,v,s){ return `<div class="kpi"><span class="l">${l}</span><b>${v}</b><span class="s">${s}</span></div>`; }

/* ---------- reviews ---------- */
async function vReviews(pane){
  const d=await api('/api/admin/reviews');
  pane.innerHTML=`${head('REVIEWS','Approve customer reviews before they appear on the store')}
  ${d.reviews.length?`<div class="panel"><table class="atable"><thead><tr><th>Set</th><th>Customer</th><th>Rating</th><th>Review</th><th>Status</th><th></th></tr></thead><tbody>
  ${d.reviews.map(r=>`<tr>
    <td>${esc(r.productName)}</td><td>${esc(r.name)}</td>
    <td style="color:#FBBF24;white-space:nowrap">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</td>
    <td style="max-width:320px">${esc(r.text)}</td>
    <td>${r.approved?'<span class="apill g">LIVE</span>':'<span class="apill y">PENDING</span>'}</td>
    <td class="ract">
      <button class="abtn sm ${r.approved?'ghost':'lime'}" onclick="RVOK('${r.id}',${!r.approved})">${r.approved?'Unpublish':'Approve'}</button>
      <button class="abtn sm danger" onclick="RVDEL('${r.id}')">Delete</button>
    </td></tr>`).join('')}
  </tbody></table></div>`
  :H.empty('☆','No reviews yet','Customer reviews submitted on product pages will appear here for approval.')}`;
  window.RVOK=async(id,v)=>{ try{ await api('/api/admin/reviews/'+id,{method:'PUT',body:{approved:v}}); toast('Updated',true); run(); }catch(e){toast(e.message);} };
  window.RVDEL=async id=>{ if(!confirm('Delete this review permanently?'))return; try{ await api('/api/admin/reviews/'+id,{method:'DELETE'}); toast('Deleted',true); run(); }catch(e){toast(e.message);} };
}

/* ---------- abandoned carts ---------- */
async function vCarts(pane){
  const d=await api('/api/admin/carts');
  pane.innerHTML=`${head('ABANDONED CARTS','Shoppers who added items but did not complete checkout')}
  ${d.carts.length?`<div class="kpis"><div class="kpi"><span class="l">Open carts</span><b>${d.carts.length}</b><span class="s">Not yet ordered</span></div>
    <div class="kpi"><span class="l">Recoverable value</span><b>${money(d.value)}</b><span class="s">Total in those carts</span></div></div>
  <div class="panel"><table class="atable"><thead><tr><th>Customer</th><th>Items</th><th>Value</th><th>Last active</th><th></th></tr></thead><tbody>
  ${d.carts.map(c=>{
    const wa=c.mobile?`https://wa.me/${H.waNumber(c.mobile)}?text=${encodeURIComponent('Hi'+(c.name?' '+c.name:'')+'! You left some poster sets in your cart at Highstreet Society. Need help completing your order?')}`:'';
    return `<tr>
    <td>${c.name?esc(c.name):'<span class="asub">Guest</span>'}<br><span class="asub">${esc(c.mobile||'no number')}</span></td>
    <td style="max-width:280px">${c.items.map(i=>esc(i.name)+' ×'+i.qty).join('<br>')}</td>
    <td>${money(c.value)}</td>
    <td class="asub">${new Date(c.updatedAt).toLocaleString('en-GB')}</td>
    <td class="ract">${wa?`<a class="abtn sm lime" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>`:''}
      <button class="abtn sm danger" onclick="ACDEL('${esc(c.key)}')">Remove</button></td></tr>`;}).join('')}
  </tbody></table></div>`
  :H.empty('🛒','No abandoned carts','When a shopper adds items but does not order, their cart appears here so you can follow up.')}`;
  window.ACDEL=async k=>{ try{ await api('/api/admin/carts/'+encodeURIComponent(k),{method:'DELETE'}); run(); }catch(e){toast(e.message);} };
}

/* ---------- content / CMS ---------- */
async function vContent(pane){
  const d=await api('/api/admin/content');
  const keys=['shipping','returns','faq','privacy','terms'];
  const c=d.content||{};
  pane.innerHTML=`${head('CONTENT / CMS','Edit your policy and info pages — they appear in the website footer')}
  ${keys.map(k=>{
    const p=c[k]||{title:k,body:''};
    return `<div class="panel" style="margin-bottom:16px">
      <h2>/policy/${k} <a class="asub" href="/policy/${k}" target="_blank" rel="noopener" style="font-size:12px">open →</a></h2>
      <div class="fld"><label>Page title</label><input id="ct_${k}" value="${esc(p.title)}"></div>
      <div class="fld"><label>Page content</label><textarea id="cb_${k}" rows="6">${esc(p.body)}</textarea></div>
      <button class="abtn lime sm" onclick="CSAVE('${k}')">Save page</button>
    </div>`;}).join('')}`;
  window.CSAVE=async k=>{ try{ await api('/api/admin/content/'+k,{method:'PUT',
    body:{title:document.getElementById('ct_'+k).value,body:document.getElementById('cb_'+k).value}});
    toast('Page saved',true); }catch(e){toast(e.message);} };
}


/* ---------- custom design requests ---------- */
async function vDesigns(pane){
  const d=await api('/api/admin/designs');
  const S=d.statuses;
  pane.innerHTML=`${head('CUSTOM DESIGNS','Customer artwork requests — review, quote and track')}
  ${d.designs.length?`<div class="alist">
  ${d.designs.map(x=>`<div class="acard">
    <div class="acard-h">
      <div><b>${esc(x.id)}</b><span class="asub">${new Date(x.createdAt).toLocaleString('en-GB')}</span></div>
      ${H.statusPill(x.status)}
    </div>
    <div class="acard-b">
      <div class="kv"><span>Customer</span><b>${esc(x.name)}</b></div>
      <div class="kv"><span>Contact</span><b><a href="https://wa.me/${H.waNumber(x.contact||x.mobile)}" target="_blank" rel="noopener">${esc(x.contact||x.mobile)}</a></b></div>
      <div class="kv"><span>Wants</span><b>${esc(x.productType)} × ${x.quantity}</b></div>
      <div class="kv full"><span>Details</span><b class="wrap">${esc(x.details)}</b></div>
      ${x.files.length?`<div class="kv full"><span>Files</span><b>${x.files.map(f=>`<a class="dfile" href="${esc(f)}" target="_blank" rel="noopener">open</a>`).join(' ')}</b></div>`:''}
    </div>
    <div class="acard-f">
      <select onchange="DGST('${x.id}',this.value)">${S.map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}</select>
      <input type="number" placeholder="Quote ৳" value="${x.quote==null?'':x.quote}" id="dq_${x.id}" style="max-width:120px">
      <input placeholder="Note to customer" value="${esc(x.adminNote||'')}" id="dn_${x.id}">
      <button class="abtn lime sm" onclick="DGSAVE('${x.id}')">Save</button>
      <button class="abtn sm danger" onclick="DGDEL('${x.id}')">Delete</button>
    </div>
  </div>`).join('')}</div>`
  :H.empty('🎨','No custom requests yet','When a logged-in customer submits a design request it appears here.')}`;
  window.DGST=async(id,status)=>{ try{ await api('/api/admin/designs/'+id,{method:'PUT',body:{status}}); toast('Status updated',true); run(); }catch(e){toast(e.message);} };
  window.DGSAVE=async id=>{ try{ await api('/api/admin/designs/'+id,{method:'PUT',body:{
      quote:document.getElementById('dq_'+id).value, adminNote:document.getElementById('dn_'+id).value }});
    toast('Saved',true); }catch(e){toast(e.message);} };
  window.DGDEL=async id=>{ if(!confirm('Delete this request?'))return; try{ await api('/api/admin/designs/'+id,{method:'DELETE'}); run(); }catch(e){toast(e.message);} };
}

/* ---------- router ---------- */
function labelTables(){
  document.querySelectorAll('.atable').forEach(t=>{
    const hs=[...t.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr=>{
      [...tr.children].forEach((td,i)=>{ if(hs[i]) td.setAttribute('data-l',hs[i]); });
    });
  });
}
async function runView(pane){
  if(A.tab==='dash') await vDash(pane);
    else if(A.tab==='analytics') await vAnalytics(pane);
    else if(A.tab==='reviews') await vReviews(pane);
    else if(A.tab==='carts') await vCarts(pane);
    else if(A.tab==='content') await vContent(pane);
    else if(A.tab==='designs') await vDesigns(pane);
    else if(A.tab==='orders') await vOrders(pane);
    else if(A.tab==='products') await vProducts(pane);
    else if(A.tab==='pnew'){ A.editId=null; await vPEdit(pane); }
    else if(A.tab==='pedit') await vPEdit(pane);
    else if(A.tab==='cats') await vCats(pane);
    else if(A.tab==='customers') await vCustomers(pane);
    else if(A.tab==='home') await vHome(pane);
    else if(A.tab==='inv') await vInv(pane);
    else if(A.tab==='coupons') await vCoupons(pane);
    else if(A.tab==='promos') await vPromos(pane);
    else if(A.tab==='exhibit') await vExhibit(pane);
    else if(A.tab==='pay') await vPay(pane);
  else if(A.tab==='settings') await vSettings(pane);
}

/* Silently re-establish an admin session using the stored credentials grant.
   Returns true when the session is usable again. Never renders the login form. */
async function run(){
  const pane=document.getElementById('pane');
  pane.innerHTML='<div class="empty"><div class="e"><span class="spin" aria-hidden="true"></span></div><h3>Loading…</h3></div>';
  try{
    await runView(pane);
    labelTables();
  }catch(e){
    // A failing SECTION is a section problem, never a session problem.
    // Nothing in here may clear the token or render the login form.
    if(e && e.status === 401){
      try{ await renewSession(); await runView(pane); labelTables(); return; }catch(e2){}
    }
    pane.innerHTML = H.empty('😕','Could not load this section',
      esc((e && e.message) ? e.message : 'Please try again.'),
      '<button class="abtn lime" onclick="run()">Retry</button>');
  }
}

// Show a neutral loading state while the session is verified, so the login
// form never flashes for an already-authenticated admin on refresh.
root.innerHTML=`<div class="loginbox"><div class="panel">
  <img src="/images/logo.png" alt="HSS" style="opacity:.8">
  <p class="asub" style="margin-top:12px">Checking your session…</p></div></div>`;
boot();
})();
