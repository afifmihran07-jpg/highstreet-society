/* HSS checkout */
(async function(){
await HSS.renderLayout('cart');
const H = HSS;
const el = document.getElementById('content');
const cart = H.getCart();
if(!cart.length){ location.href='/cart'; return; }

// prefill from account
let me=null;
if(H.loggedIn()){ try{ me=(await H.api('/api/auth/me')).customer; }catch(e){} }

const S = H.settings, del=S.delivery, pay=S.payments;
let items=[], subtotal=0, zone='inside', method = pay.cod.enabled?'cod':(pay.bkash.enabled?'bkash':(pay.nagad.enabled?'nagad':'cod'));
let coupon=null, discount=0;

el.innerHTML = `<div class="shophead"><h1>CHECKOUT</h1><p>Almost yours — delivery & payment details below.</p></div>
<div class="split">
  <div>
    <div class="panel" style="margin-bottom:18px"><h2 class="steph"><span>01</span>Delivery information</h2>
      <div class="fgrid2">
        <div class="fld"><label>Full name *</label><input id="f_name" placeholder="e.g. Tasin Ahmed" value="${H.esc(me?me.name:'')}"></div>
        <div class="fld"><label>Mobile number *</label><input id="f_mobile" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX" value="${H.esc(me?me.mobile:'')}"></div>
      </div>
      <div class="fgrid2">
        <div class="fld"><label>Division *</label><select id="f_div"><option value="">Select division</option></select></div>
        <div class="fld"><label>District *</label><select id="f_dist" disabled><option value="">Select district</option></select></div>
      </div>
      <div class="fld"><label>Thana / Upazila *</label>
        <input id="f_areaq" placeholder="Type to search e.g. Dhanmondi" autocomplete="off" disabled>
        <select id="f_area" disabled size="1"><option value="">Select thana / upazila</option></select>
      </div>
      <div class="fgrid2">
        <div class="fld"><label>Area / locality *</label><input id="f_local" type="text" placeholder="e.g. Mohammadpur, Bosila" autocomplete="off" value="${H.esc(me&&me.locality?me.locality:'')}"></div>
        <div class="fld"><label>Landmark (optional)</label><input id="f_landmark" placeholder="e.g. beside Shubastu Tower" value="${H.esc(me&&me.landmark?me.landmark:'')}"></div>
      </div>
      <div class="fld" style="margin-bottom:0"><label>House / road / block / floor *</label><textarea id="f_addr" rows="2" placeholder="e.g. House 12, Road 5, Block C, 3rd floor">${H.esc(me?me.address:'')}</textarea></div>
      ${me?`<label class="savepf"><input type="checkbox" id="f_savepf"><span>Save these details to my profile for next time</span></label>`:''}
    </div>
    <div class="panel" style="margin-bottom:18px"><h2 class="steph"><span>02</span>Delivery charge</h2>
      <div id="zonebox" class="zonebox">Select your district and thana to see the delivery charge.</div>
      ${del.freeAbove>0?`<p style="font-size:13px;color:var(--ok);font-weight:700;margin-top:10px">Free delivery on orders over ${H.money(del.freeAbove)} 🎉</p>`:''}
    </div>
    <div class="panel"><h2 class="steph"><span>03</span>Payment method</h2><div id="paylist"></div>
      <div class="fld" style="margin-top:6px"><label>Order notes (optional)</label><input id="f_notes" placeholder="Anything we should know?"></div>
    </div>
  </div>
  <div class="panel"><h2>Order summary</h2><div id="citems"></div>
    <div class="couponrow"><input id="f_coupon" placeholder="Coupon code"><button class="btn btn-ghost btn-sm" onclick="APPLY()">Apply</button></div>
    <div class="cmsg" id="cmsg"></div>
    <div id="sum" style="margin-top:10px"></div>
    <button class="btn btn-lime btn-block" id="place" style="margin-top:16px" onclick="PLACE()">Place Order →</button>
    <p style="font-size:12.5px;color:var(--dim);margin-top:10px;text-align:center">No account needed • Pay on delivery or via bKash/Nagad</p>
  </div>
</div>`;

let zoneReady=false;
function charge(){ let c = zone==='inside'?del.inside:del.outside; if(del.freeAbove>0 && (subtotal-discount)>=del.freeAbove) c=0; return c; }
function renderZone(){
  const box=document.getElementById('zonebox');
  if(!box) return;
  if(!zoneReady){ box.className='zonebox'; box.textContent='Select your district and thana to see the delivery charge.'; return; }
  const label = zone==='inside'?del.insideLabel:del.outsideLabel;
  const c=charge();
  box.className='zonebox on';
  box.innerHTML=`<div><b>${H.esc(label)}</b><span>${H.esc(SEL.area)}, ${H.esc(SEL.district)}</span></div>
    <div class="amt">${c===0?'<span class="free">FREE</span>':H.money(c)}</div>`;
}
function renderSum(){
  document.getElementById('sum').innerHTML = `
    <div class="sumrow"><span>Subtotal</span><span>${H.money(subtotal)}</span></div>
    ${discount?`<div class="sumrow"><span>Coupon ${H.esc(coupon)} <button class="rm" style="background:none;border:none;color:var(--danger);font-weight:700" onclick="RMCOUPON()">✕</button></span><span class="free">−${H.money(discount)}</span></div>`:''}
    <div class="sumrow"><span>Delivery</span><span>${charge()===0?'<span class="free">FREE</span>':H.money(charge())}</span></div>
    <div class="sumrow total"><span>Total</span><span>${H.money(subtotal-discount+charge())}</span></div>`;
}
function renderPay(){
  const box=document.getElementById('paylist');
  const m = id => `SETPAY('${id}')`;
  let html='';
  if(pay.cod.enabled) html+=`<div class="paym ${method==='cod'?'on':''}" onclick="${m('cod')}"><div class="t"><span class="radio"></span>Cash on Delivery</div><div class="d">Pay in cash when your posters arrive. No advance needed.</div></div>`;
  if(pay.bkash.enabled) html+=`<div class="paym ${method==='bkash'?'on':''}" onclick="${m('bkash')}"><div class="t"><span class="radio"></span><span style="color:#E2136E">bKash</span> — Send Money</div>
    ${method==='bkash'?`<div class="paybox">${H.esc(pay.bkash.instruction||'')}<br><br>Number: <b class="num">${H.esc(pay.bkash.number)}</b> <span style="color:var(--mut)">(${H.esc(pay.bkash.accountType)})</span><div class="fld" style="margin:12px 0 0"><label>Transaction ID (TrxID) *</label><input id="f_trx" placeholder="e.g. 9HXK2LDM4P" onclick="event.stopPropagation()"></div></div>`:''}</div>`;
  if(pay.nagad.enabled) html+=`<div class="paym ${method==='nagad'?'on':''}" onclick="${m('nagad')}"><div class="t"><span class="radio"></span><span style="color:#F6921E">Nagad</span> — Send Money</div>
    ${method==='nagad'?`<div class="paybox">${H.esc(pay.nagad.instruction||'')}<br><br>Number: <b class="num">${H.esc(pay.nagad.number)}</b> <span style="color:var(--mut)">(${H.esc(pay.nagad.accountType)})</span><div class="fld" style="margin:12px 0 0"><label>Transaction ID (TrxID) *</label><input id="f_trx" placeholder="e.g. 9HXK2LDM4P" onclick="event.stopPropagation()"></div></div>`:''}</div>`;
  box.innerHTML=html||'<p>No payment methods available right now.</p>';
}
window.SETZONE = z => { zone=z; document.getElementById('z_inside').classList.toggle('on',z==='inside'); document.getElementById('z_outside').classList.toggle('on',z==='outside'); renderSum(); };
window.SETPAY = m => { method=m; renderPay(); };
window.APPLY = async () => {
  const code=document.getElementById('f_coupon').value.trim(), msg=document.getElementById('cmsg');
  if(!code) return;
  try{ const d=await H.api('/api/coupons/validate',{method:'POST',body:{code,subtotal}});
    coupon=d.code; discount=d.discount; msg.className='cmsg ok'; msg.textContent=`${coupon} applied — you save ${H.money(discount)}`; renderSum();
  }catch(e){ msg.className='cmsg err'; msg.textContent=e.message; }
};
window.RMCOUPON = () => { coupon=null; discount=0; document.getElementById('cmsg').textContent=''; document.getElementById('f_coupon').value=''; renderSum(); };
window.PLACE = async () => {
  const btn=document.getElementById('place');
  const body={ name:document.getElementById('f_name').value.trim(), mobile:document.getElementById('f_mobile').value.trim(),
    address:document.getElementById('f_addr').value.trim(),
    locality:document.getElementById('f_local').value.trim(),
    landmark:document.getElementById('f_landmark').value.trim(),
    division:SEL.division, district:SEL.district, area:SEL.area,
    zone, cartKey:HSS.store.get('hss_cart_key')||'', paymentMethod:method, notes:document.getElementById('f_notes').value.trim(),
    items:H.getCart(), coupon };
  const trx=document.getElementById('f_trx'); if(trx) body.trxId=trx.value.trim();
  if(body.name.length<3) return H.toast('Please enter your full name');
  if(!/^01[3-9]\d{8}$/.test(body.mobile)) return H.toast('Please enter a valid 11-digit mobile number');
  if(!SEL.division) return H.toast('Please select your division');
  if(!SEL.district) return H.toast('Please select your district');
  if(!SEL.area) return H.toast('Please select your thana / upazila');
  if(!body.locality || body.locality.length<2) return H.toast('Please enter your area / locality');
  if(body.address.length<8) return H.toast('Please enter your house / road details');
  if((method==='bkash'||method==='nagad') && !body.trxId) return H.toast('Please enter your Transaction ID (TrxID)');
  HSS.store.set('hss_name',body.name); HSS.store.set('hss_mobile',body.mobile);
  btn.disabled=true; btn.textContent='Placing order…';
  try{
    const d=await H.api('/api/orders',{method:'POST',body});
    // Opt-in only: the saved profile is updated ONLY if the customer ticked
    // the box. A one-off change at checkout never rewrites the profile.
    const savePf = document.getElementById('f_savepf');
    if(savePf && savePf.checked){
      try{
        await H.api('/api/auth/me',{method:'PUT',body:{
          name:body.name, mobile:body.mobile, address:body.address,
          locality:body.locality, landmark:body.landmark,
          division:body.division, district:body.district, area:body.area }});
      }catch(e){ /* order already placed; profile save is best-effort */ }
    }
    H.setCart([]);
    location.href='/success?id='+encodeURIComponent(d.order.id)+'&mobile='+encodeURIComponent(d.order.customer.mobile);
  }catch(e){ H.toast(e.message); btn.disabled=false; btn.textContent='Place Order →'; }
};

// load items
const ci=document.getElementById('citems');
for(const it of H.getCart()){
  try{
    const d=await H.api('/api/products/'+encodeURIComponent(it.id));
    const p=d.product, sz=it.size||null;
    let avail=p.stock;
    if(sz&&(p.sizes||[]).length){ const row=p.sizes.find(x=>x.size.toLowerCase()===String(sz).toLowerCase()); avail=row?row.stock:0; }
    const q=Math.min(it.qty||1, p.allowBackorder?20:Math.max(1,avail));
    items.push({p,q,sz}); subtotal+=p.effPrice*q;
    ci.insertAdjacentHTML('beforeend',`<div class="citem" style="grid-template-columns:56px 1fr auto">
      <img src="${H.esc(p.cover)}" style="width:56px;height:68px" alt="" onerror="this.src='/images/logo.png'">
      <div><h3 style="font-size:14px">${H.esc(p.name)}</h3><div class="m">${sz?`Size <b class="szchip">${H.esc(sz)}</b> • `:''}Qty ${q}</div></div>
      <div class="r"><b style="font-size:14.5px">${H.money(p.effPrice*q)}</b></div></div>`);
  }catch(e){}
}
if(!items.length){ location.href='/cart'; return; }
renderPay(); renderSum();

/* ---------- Bangladesh location picker: all divisions, districts, thanas ---------- */
const SEL={division:'',district:'',area:''};
window.SEL=SEL;
const DHAKA_CITY=new Set(['adabor','airport','badda','banani','bangshal','bhashantek','bhatara','cantonment','chackbazar','dakshinkhan','darus salam','demra','dhanmondi','gendaria','gulshan','hazaribagh','jatrabari','kadamtali','kafrul','kalabagan','kamrangirchar','khilgaon','khilkhet','kotwali','lalbagh','mirpur','mohammadpur','motijheel','mugda','new market','pallabi','paltan','ramna','rampura','rupnagar','sabujbagh','shah ali','shahbagh','shahjahanpur','sher-e-bangla nagar','shyampur','sutrapur','tejgaon','tejgaon industrial area','turag','uttara east','uttara west','uttarkhan','vatara','wari']);
const dvSel=document.getElementById('f_div'), dsSel=document.getElementById('f_dist'),
      arSel=document.getElementById('f_area'), arQ=document.getElementById('f_areaq');
let GEO=[];
try{
  const cached=HSS.store.get('hss_geo');
  if(cached){ GEO=JSON.parse(cached); }
  else { GEO=await H.api('/api/geo'); HSS.store.set('hss_geo',JSON.stringify(GEO)); }
}catch(e){ try{ GEO=await H.api('/api/geo'); }catch(_){ GEO=[]; } }

function opts(sel, list, placeholder){
  sel.innerHTML='<option value="">'+placeholder+'</option>'+list.map(v=>`<option value="${H.esc(v)}">${H.esc(v)}</option>`).join('');
}
opts(dvSel, GEO.map(d=>d.name), 'Select division');
let areaList=[];
function applyZone(){
  zoneReady = !!(SEL.district && SEL.area);
  zone = (SEL.district.toLowerCase()==='dhaka' && DHAKA_CITY.has(SEL.area.toLowerCase())) ? 'inside' : 'outside';
  renderZone(); renderSum();
}
dvSel.onchange=()=>{
  SEL.division=dvSel.value; SEL.district=''; SEL.area=''; arQ.value='';
  const d=GEO.find(x=>x.name===SEL.division);
  opts(dsSel, d?d.districts.map(t=>t.name):[], 'Select district');
  dsSel.disabled=!d; arSel.disabled=true; arQ.disabled=true;
  opts(arSel, [], 'Select thana / upazila');
  applyZone();
};
dsSel.onchange=()=>{
  SEL.district=dsSel.value; SEL.area=''; arQ.value='';
  const d=GEO.find(x=>x.name===SEL.division);
  const t=d&&d.districts.find(x=>x.name===SEL.district);
  areaList=t?t.areas:[];
  opts(arSel, areaList, 'Select thana / upazila');
  arSel.disabled=!areaList.length; arQ.disabled=!areaList.length;
  applyZone();
};
arSel.onchange=()=>{ SEL.area=arSel.value; applyZone(); };
arQ.oninput=()=>{
  const q=arQ.value.toLowerCase().trim();
  const f=q?areaList.filter(a=>a.toLowerCase().includes(q)):areaList;
  opts(arSel, f, f.length?'Select thana / upazila':'No match — check spelling');
  if(f.length===1){ arSel.value=f[0]; SEL.area=f[0]; applyZone(); }
  else { SEL.area=''; applyZone(); }
};
// Auto-fill the saved delivery location for a logged-in customer. These are
// only DEFAULTS: the customer can change any field for this one order, and
// doing so never rewrites their saved profile.
if(me && me.division){
  const d = GEO.find(x=>x.name===me.division);
  if(d){
    dvSel.value = me.division; SEL.division = me.division;
    opts(dsSel, d.districts.map(t=>t.name), 'Select district');
    dsSel.disabled = false;
    const t = d.districts.find(x=>x.name===me.district);
    if(t){
      dsSel.value = me.district; SEL.district = me.district;
      areaList = t.areas;
      opts(arSel, areaList, 'Select thana / upazila');
      arSel.disabled = false; arQ.disabled = false;
      if(me.area && areaList.includes(me.area)){
        arSel.value = me.area; SEL.area = me.area;
      }
    }
    applyZone();
  }
}
renderZone();
})();
