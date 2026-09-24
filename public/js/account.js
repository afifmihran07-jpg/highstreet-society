/* HSS customer account */
(async function(){
await HSS.renderLayout('account');
const H=HSS, el=document.getElementById('content');
let tab='orders', me=null;

async function boot(){
  if(!H.loggedIn()) return loginView();
  try{ me=(await H.api('/api/auth/me')).customer; }catch(e){ HSS.store.remove('hss_token'); return loginView(); }
  el.innerHTML=`<div class="shophead"><h1>HEY, ${H.esc(me.name.split(' ')[0].toUpperCase())} ✦</h1><p>${H.esc(me.mobile)}</p></div>
  <div class="acctabs">
    <button data-t="orders" class="${tab==='orders'?'on':''}">My Orders</button>
    <button data-t="profile" class="${tab==='profile'?'on':''}">Profile</button>
    <button onclick="HSS.logout()">Logout</button>
  </div><div id="pane"></div>`;
  el.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;boot();});
  const pane=document.getElementById('pane');
  if(tab==='profile'){
    renderProfile(pane, false);
  } else {
    pane.innerHTML=`<div class="empty"><div class="e">◌</div><h3>Loading orders…</h3></div>`;
    try{
      const d=await H.api('/api/orders/mine');
      if(!d.orders.length){ pane.innerHTML=H.empty('📦','No orders yet','Your orders will show up here.','<a class="btn btn-lime" href="/shop">Shop sets</a>'); return; }
      pane.innerHTML=d.orders.map(o=>`<div class="obox"><div class="oh"><b>${H.esc(o.id)}</b>${H.statusPill(o.status)}</div>
        <div class="oitems">${o.items.map(i=>`<a href="/product/${i.slug}"><img src="${H.esc(i.cover)}" alt="${H.esc(i.name)}" title="${H.esc(i.name)} × ${i.qty}" onerror="this.src='/images/logo.png'"></a>`).join('')}</div>
        <div class="sumrow"><span>${new Date(o.createdAt).toLocaleString()} • ${o.items.reduce((s,i)=>s+i.qty,0)} item(s) • ${o.paymentMethod.toUpperCase()}</span><b>${H.money(o.total)}</b></div>
        <div class="arow" style="margin-top:10px;display:flex;gap:10px"><a class="btn btn-ghost btn-sm" href="/track?id=${o.id}&mobile=${o.customer.mobile}">Track</a><button class="btn btn-ghost btn-sm" onclick='REORDER(${JSON.stringify(o.items.map(i=>({id:i.productId,qty:i.qty})))})'>Reorder</button></div>
      </div>`).join('');
      window.REORDER=items=>{ const c=H.getCart(); items.forEach(it=>{ const f=c.find(x=>x.id===it.id); if(f) f.qty=Math.min(20,f.qty+it.qty); else c.push(it); }); H.setCart(c); location.href='/cart'; };
    }catch(e){ pane.innerHTML=H.empty('😕','Could not load orders',H.esc(e.message)); }
  }
}
function loginView(mode='login'){
  el.innerHTML=`<div class="centerbox"><div class="panel" style="margin-top:34px"><h2 style="text-align:center">${mode==='login'?'Welcome back ✦':'Join the Society ✦'}</h2>
    <p style="text-align:center;color:var(--mut);font-size:14px;margin:-8px 0 20px">${mode==='login'?'Login to track orders faster.':'Create an account for faster checkout & order history.'}</p>
    ${mode==='register'?'<div class="fld"><label>Full name *</label><input id="a_name" placeholder="Your name"></div>':''}
    <div class="fld"><label>Mobile number *</label><input id="a_mobile" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX"></div>
    <div class="fld"><label>Password *</label><input id="a_pw" type="password" placeholder="••••••"></div>
    <div id="a_err" class="cmsg err" style="display:none"></div>
    <button class="btn btn-lime btn-block" onclick="GO('${mode}')">${mode==='login'?'Login':'Create account'}</button>
    ${mode==='login'?'<p style="text-align:center;margin-top:12px;font-size:14px"><a href="#" id="forgotLink" onclick="event.preventDefault();FORGOT()" style="color:var(--lime);font-weight:800">Forgot password?</a></p>':''}
    <p style="text-align:center;margin-top:16px;font-size:14px;color:var(--mut)">${mode==='login'?'New here? <a href="#" onclick="event.preventDefault();MODE()" style="color:var(--lime);font-weight:800">Create an account</a>':'Have an account? <a href="#" onclick="event.preventDefault();MODE()" style="color:var(--lime);font-weight:800">Login</a>'}</p>
    <p style="text-align:center;margin-top:8px;font-size:13px;color:var(--dim)">Guest checkout is always available — no account needed to order.</p>
  </div></div>`;
  window.MODE=()=>loginView(mode==='login'?'register':'login');
  window.GO=async m=>{
    const body={mobile:document.getElementById('a_mobile').value.trim(),password:document.getElementById('a_pw').value};
    if(m==='register') body.name=document.getElementById('a_name').value.trim();
    try{ const d=await H.api('/api/auth/'+m,{method:'POST',body}); HSS.store.set('hss_token',d.token); H.toast('Welcome!',true);
      const nx=new URLSearchParams(location.search).get('next');
      if(nx && /^\/[a-z0-9\-\/]*$/i.test(nx)){ location.href=nx; return; }
      boot(); }
    catch(e){
      const msg = (m==='login' && e.status===400)
        ? 'Incorrect phone number or password.'
        : e.message;
      H.toast(msg);
      const box=document.getElementById('a_err');
      if(box){ box.textContent=msg; box.style.display='block'; }
    }
  };
  window.FORGOT=()=>forgotView();
}

/* ---- Forgot / reset password (uses the existing customer auth) ---- */
function forgotView(){
  el.innerHTML=`<div class="centerbox"><div class="panel" style="margin-top:34px">
    <h2 style="text-align:center">Reset password ✦</h2>
    <p style="text-align:center;color:var(--mut);font-size:14px;margin:-8px 0 20px">
      Enter your registered mobile number to set a new password.</p>
    <div id="f_err" class="cmsg err" style="display:none"></div>
    <div class="fld"><label>Mobile number *</label>
      <input id="f_mobile" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX"></div>
    <button class="btn btn-lime btn-block" id="f_go" onclick="FGO()">Continue</button>
    <p style="text-align:center;margin-top:16px;font-size:14px">
      <a href="#" onclick="event.preventDefault();BACKLOGIN()" style="color:var(--lime);font-weight:800">← Back to login</a></p>
  </div></div>`;
  window.BACKLOGIN=()=>loginView('login');
  window.FGO=async()=>{
    const mobile=document.getElementById('f_mobile').value.trim();
    const err=document.getElementById('f_err');
    const btn=document.getElementById('f_go');
    err.style.display='none';
    if(!/^01[3-9]\d{8}$/.test(mobile)){
      err.textContent='Please enter a valid 11-digit mobile number'; err.style.display='block'; return;
    }
    btn.disabled=true; btn.textContent='Checking…';
    try{
      const d=await H.api('/api/auth/forgot',{method:'POST',body:{mobile}});
      if(d.resetToken){ resetView(d.resetToken, mobile); }
      else{
        // No account: identical wording, so numbers can't be probed.
        err.textContent=d.message||'If this mobile number has an account, you can now set a new password.';
        err.style.display='block';
        btn.disabled=false; btn.textContent='Continue';
      }
    }catch(e){
      err.textContent=e.message; err.style.display='block';
      btn.disabled=false; btn.textContent='Continue';
    }
  };
}

function resetView(resetToken, mobile){
  el.innerHTML=`<div class="centerbox"><div class="panel" style="margin-top:34px">
    <h2 style="text-align:center">Set a new password ✦</h2>
    <p style="text-align:center;color:var(--mut);font-size:14px;margin:-8px 0 20px">
      For ${H.esc(mobile)}</p>
    <div id="r_err" class="cmsg err" style="display:none"></div>
    <div class="fld"><label>New password *</label>
      <input id="r_pw" type="password" placeholder="At least 4 characters"></div>
    <div class="fld"><label>Confirm new password *</label>
      <input id="r_pw2" type="password" placeholder="Repeat password"></div>
    <button class="btn btn-lime btn-block" id="r_go" onclick="RGO()">Save new password</button>
    <p style="text-align:center;margin-top:16px;font-size:14px">
      <a href="#" onclick="event.preventDefault();BACKLOGIN()" style="color:var(--lime);font-weight:800">← Back to login</a></p>
  </div></div>`;
  window.BACKLOGIN=()=>loginView('login');
  window.RGO=async()=>{
    const pw=document.getElementById('r_pw').value;
    const pw2=document.getElementById('r_pw2').value;
    const err=document.getElementById('r_err');
    const btn=document.getElementById('r_go');
    err.style.display='none';
    if(pw.length<4){ err.textContent='Password must be at least 4 characters'; err.style.display='block'; return; }
    if(pw!==pw2){ err.textContent='Both passwords must match'; err.style.display='block'; return; }
    btn.disabled=true; btn.textContent='Saving…';
    try{
      const d=await H.api('/api/auth/reset',{method:'POST',body:{resetToken,password:pw}});
      HSS.store.set('hss_token', d.token);
      H.toast('Password updated — you are signed in',true);
      boot();
    }catch(e){
      err.textContent=e.message; err.style.display='block';
      btn.disabled=false; btn.textContent='Save new password';
    }
  };
}
boot();

/* ---------- Customer profile: read-only view + edit mode ---------- */
let GEO_CACHE = null;
async function loadGeo(){
  if(GEO_CACHE) return GEO_CACHE;
  try{
    const cached = HSS.store.get('hss_geo');
    GEO_CACHE = cached ? JSON.parse(cached) : await H.api('/api/geo');
    if(!cached) HSS.store.set('hss_geo', JSON.stringify(GEO_CACHE));
  }catch(e){ GEO_CACHE = []; }
  return GEO_CACHE;
}

function row(label, value, hint){
  const empty = !value;
  return `<div class="pfrow">
    <span class="pflabel">${H.esc(label)}</span>
    <span class="pfvalue${empty?' empty':''}">${empty ? H.esc(hint||'Not added yet') : H.esc(value)}</span>
  </div>`;
}

function renderProfile(pane, editing){
  if(!editing){
    pane.innerHTML = `<div class="panel pfcard">
      <div class="pfhead"><h2>My Profile</h2>
        <button class="btn btn-lime btn-sm" id="pf_edit">Edit Profile</button></div>
      ${row('Name', me.name)}
      ${row('Mobile', me.mobile)}
      ${row('Delivery address', me.address, 'Add your house / road details')}
      ${row('Area / locality', me.locality, 'Add your area')}
      ${row('Thana / Upazila', me.area, 'Not selected')}
      ${row('District', me.district, 'Not selected')}
      ${row('Division', me.division, 'Not selected')}
      ${row('Landmark', me.landmark, 'Optional')}
      <p class="pfnote">Saved details are filled in automatically at checkout. You can still change them for any single order.</p>
    </div>`;
    document.getElementById('pf_edit').onclick = ()=>renderProfile(pane, true);
    return;
  }

  pane.innerHTML = `<div class="panel pfcard">
    <div class="pfhead"><h2>Edit Profile</h2></div>
    <div id="pf_err" class="cmsg err" style="display:none"></div>
    <div class="fld"><label>Full name *</label><input id="pf_name" value="${H.esc(me.name||'')}"></div>
    <div class="fld"><label>Mobile number *</label>
      <input id="pf_mobile" inputmode="numeric" maxlength="11" value="${H.esc(me.mobile||'')}"></div>
    <div class="fgrid2">
      <div class="fld"><label>Division</label><select id="pf_div"><option value="">Select division</option></select></div>
      <div class="fld"><label>District</label><select id="pf_dist"><option value="">Select district</option></select></div>
    </div>
    <div class="fld"><label>Thana / Upazila</label><select id="pf_area"><option value="">Select thana</option></select></div>
    <div class="fgrid2">
      <div class="fld"><label>Area / locality</label>
        <input id="pf_local" type="text" autocomplete="off" placeholder="e.g. Mohammadpur, Bosila" value="${H.esc(me.locality||'')}"></div>
      <div class="fld"><label>Landmark (optional)</label>
        <input id="pf_landmark" placeholder="e.g. beside Rapa Plaza" value="${H.esc(me.landmark||'')}"></div>
    </div>
    <div class="fld"><label>House / road / block / floor</label>
      <textarea id="pf_addr" rows="2" placeholder="e.g. House 12, Road 5, 3rd floor">${H.esc(me.address||'')}</textarea></div>
    <div class="arow" style="display:flex;gap:10px;margin-top:6px">
      <button class="btn btn-lime" id="pf_save">Save Changes</button>
      <button class="btn btn-ghost" id="pf_cancel">Cancel</button>
    </div>
  </div>`;

  document.getElementById('pf_cancel').onclick = ()=>renderProfile(pane, false);

  // cascading geo selects, pre-selected from the saved profile
  (async ()=>{
    const geo = await loadGeo();
    const dv=document.getElementById('pf_div'), ds=document.getElementById('pf_dist'), ar=document.getElementById('pf_area');
    if(!dv) return;
    const fill=(sel,list,ph,cur)=>{ sel.innerHTML=`<option value="">${ph}</option>`+
      list.map(v=>`<option value="${H.esc(v)}"${v===cur?' selected':''}>${H.esc(v)}</option>`).join(''); };
    fill(dv, geo.map(d=>d.name), 'Select division', me.division);
    const dists=()=>{ const d=geo.find(x=>x.name===dv.value); return d?d.districts.map(t=>t.name):[]; };
    const areas=()=>{ const d=geo.find(x=>x.name===dv.value); const t=d&&d.districts.find(x=>x.name===ds.value);
      return t?t.areas:[]; };
    fill(ds, dists(), 'Select district', me.district);
    fill(ar, areas(), 'Select thana', me.area);
    dv.onchange=()=>{ fill(ds, dists(), 'Select district', ''); fill(ar, [], 'Select thana', ''); };
    ds.onchange=()=>{ fill(ar, areas(), 'Select thana', ''); };
  })();

  document.getElementById('pf_save').onclick = async ()=>{
    const btn=document.getElementById('pf_save'), err=document.getElementById('pf_err');
    err.style.display='none';
    const body={
      name: document.getElementById('pf_name').value.trim(),
      mobile: document.getElementById('pf_mobile').value.trim(),
      division: document.getElementById('pf_div').value,
      district: document.getElementById('pf_dist').value,
      area: document.getElementById('pf_area').value,
      locality: document.getElementById('pf_local').value.trim(),
      landmark: document.getElementById('pf_landmark').value.trim(),
      address: document.getElementById('pf_addr').value.trim()
    };
    if(body.name.length<3){ err.textContent='Please enter your full name'; err.style.display='block'; return; }
    if(!/^01[3-9]\d{8}$/.test(body.mobile)){ err.textContent='Please enter a valid 11-digit mobile number'; err.style.display='block'; return; }
    btn.disabled=true; btn.textContent='Saving…';
    try{
      const d=await H.api('/api/auth/me',{method:'PUT',body});
      me = d.customer;                       // authoritative server copy
      H.toast('Profile saved',true);
      boot();                                // re-render header + read-only view
    }catch(e){
      err.textContent=e.message; err.style.display='block';
      btn.disabled=false; btn.textContent='Save Changes';
    }
  };
}
})();
