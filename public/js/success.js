/* HSS order success */
(async function(){
await HSS.renderLayout('');
const H=HSS, el=document.getElementById('content');
const qs=new URLSearchParams(location.search);
const id=qs.get('id'), mobile=qs.get('mobile');
if(!id||!mobile){ el.innerHTML=H.empty('🛒','No order here','Place an order first.','<a class="btn btn-lime" href="/shop">Shop sets</a>'); return; }
try{
  const d=await H.api('/api/orders/track?id='+encodeURIComponent(id)+'&mobile='+encodeURIComponent(mobile));
  const o=d.order;
  el.innerHTML=`<div class="okhero">
    <div class="tick">✓</div>
    <h1>ORDER CONFIRMED!</h1>
    <p>Thanks ${H.esc(o.customer.name.split(' ')[0])} — we got your order and will call <b>${H.esc(o.customer.mobile)}</b> to confirm. ${o.paymentMethod==='cod'?'Keep '+H.money(o.total)+' ready on delivery.':'We will verify your '+o.paymentMethod.toUpperCase()+' payment ('+H.esc(o.trxId||'')+') shortly.'}</p>
    <div class="oidbox"><span style="color:var(--mut);font-size:13.5px;font-weight:700">ORDER ID</span><b>${H.esc(o.id)}</b></div>
    <div class="panel" style="text-align:left">
      ${o.items.map(i=>`<div class="citem" style="grid-template-columns:56px 1fr auto"><img src="${H.esc(i.cover)}" style="width:56px;height:68px" alt="" onerror="this.src='/images/logo.png'"><div><h3 style="font-size:14px">${H.esc(i.name)}</h3><div class="m">Qty ${i.qty} × ${H.money(i.price)}</div></div><div class="r"><b>${H.money(i.price*i.qty)}</b></div></div>`).join('')}
      <div class="sumrow"><span>Subtotal</span><span>${H.money(o.subtotal)}</span></div>
      ${o.discount?`<div class="sumrow"><span>Discount</span><span class="free">−${H.money(o.discount)}</span></div>`:''}
      <div class="sumrow"><span>Delivery</span><span>${H.money(o.deliveryCharge)}</span></div>
      <div class="sumrow total"><span>Total</span><span>${H.money(o.total)}</span></div>
    </div>
    <div style="display:flex;gap:12px;margin-top:22px;flex-wrap:wrap;justify-content:center">
      <a class="btn btn-lime" href="/track?id=${encodeURIComponent(o.id)}&mobile=${encodeURIComponent(o.customer.mobile)}">Track Order</a>
      <a class="btn btn-ghost" href="/shop">Keep Shopping</a>
    </div></div>`;
}catch(e){ el.innerHTML=H.empty('😕','Order not found','We could not find this order.','<a class="btn btn-lime" href="/track">Track order</a>'); }
})();
