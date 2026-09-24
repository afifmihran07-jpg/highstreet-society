/* HSS order tracking */
(async function(){
await HSS.renderLayout('track');
const H=HSS, el=document.getElementById('content');
const qs=new URLSearchParams(location.search);
el.innerHTML=`<div class="shophead"><h1>TRACK ORDER</h1><p>Enter your Order ID + the mobile number you ordered with.</p></div>
<div class="split split-track">
  <div class="panel"><h2>Find your order</h2>
    <div class="fld"><label>Order ID *</label><input id="t_id" placeholder="e.g. HSS-1001" value="${H.esc(qs.get('id')||'')}"></div>
    <div class="fld"><label>Mobile number *</label><input id="t_mobile" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX" value="${H.esc(qs.get('mobile')||'')}"></div>
    <button class="btn btn-lime btn-block" onclick="TRACK()">Track →</button>
  </div>
  <div class="panel" id="res"><div class="empty"><div class="e">📦</div><h3>Your order status will appear here</h3><p>We confirm every order by phone call.</p></div></div>
</div>`;
const STEPS=[['pending','Order placed','We received your order'],['payment-pending','Payment check','Verifying bKash/Nagad (COD skips this)'],['confirmed','Confirmed','Confirmed by phone'],['processing','Processing','Packing your posters'],['ready','Ready','Ready for courier pickup'],['shipped','Shipped','On the way to you'],['delivered','Delivered','Enjoy your new walls!']];
window.TRACK=async()=>{
  const id=document.getElementById('t_id').value.trim(), mobile=document.getElementById('t_mobile').value.trim();
  const res=document.getElementById('res');
  if(!id||!mobile) return H.toast('Enter Order ID and mobile number');
  res.innerHTML=`<div class="empty"><div class="e">◌</div><h3>Looking up…</h3></div>`;
  try{
    const d=await H.api('/api/orders/track?id='+encodeURIComponent(id)+'&mobile='+encodeURIComponent(mobile));
    const o=d.order;
    const cur=o.status==='cancelled'?-2:STEPS.findIndex(s=>s[0]===o.status);
    const payTxt={unpaid:'Unpaid (pay on delivery)','pending-verification':'Verifying payment',paid:'Paid',failed:'Failed',refunded:'Refunded'}[o.paymentStatus]||o.paymentStatus;
    res.innerHTML=`<div class="oh" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div><b style="font-size:20px">${H.esc(o.id)}</b><br><span style="font-size:13px;color:var(--mut)">${new Date(o.createdAt).toLocaleString()} • ${H.money(o.total)} • ${o.paymentMethod.toUpperCase()} • ${H.esc(payTxt)}</span></div>
        ${H.statusPill(o.status)}</div>
      ${o.status==='cancelled'?'<div class="empty"><div class="e">✕</div><h3>This order was cancelled</h3><p>Contact us if you need help re-ordering.</p></div>':`<div class="timeline">${STEPS.map((s,i)=>`
        <div class="tstep ${i<cur||o.status==='delivered'&&i<=cur?'done':i===cur?'now':''}"><span class="tdot">${i<cur||o.status==='delivered'&&i<=cur?'✓':(i+1)}</span><div><b>${s[1]}</b><span>${s[2]}</span></div></div>`).join('')}</div>`}
      <div class="oitems" style="margin-top:6px">${o.items.map(i=>`<img src="${H.esc(i.cover)}" alt="${H.esc(i.name)}" title="${H.esc(i.name)} × ${i.qty}" onerror="this.src='/images/logo.png'">`).join('')}</div>
      <div class="sumrow" style="margin-top:12px"><span>Deliver to</span><span style="text-align:right">${H.esc(o.customer.name)}<br>${H.esc(o.customer.address)}</span></div>`;
  }catch(e){ res.innerHTML=H.empty('😕','Order not found',H.esc(e.message)); }
};
if(qs.get('id')&&qs.get('mobile')) TRACK();
})();
