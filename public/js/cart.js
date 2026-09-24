/* HSS cart page */
(async function(){
await HSS.renderLayout('cart');
const H = HSS;
const el = document.getElementById('content');
async function render(){
  const cart = H.getCart();
  if(!cart.length){
    el.innerHTML = `<div style="padding:30px 0">${H.empty('🛒','Your cart is empty','Every great wall starts with a single set.','<a class="btn btn-lime" href="/shop">Browse poster sets</a>')}</div>`;
    return;
  }
  el.innerHTML = `<div class="shophead"><h1>YOUR CART</h1><p>${H.cartCount()} item(s)</p></div>
  <div class="split"><div class="panel" id="items"><div class="empty"><div class="e">◌</div></div></div>
  <div class="panel"><h2>Summary</h2><div id="sum"></div></div></div>`;
  // resolve products
  const box=document.getElementById('items'), sum=document.getElementById('sum');
  let subtotal=0, valid=[];
  box.innerHTML='';
  for(const it of cart){
    try{
      const d = await H.api('/api/products/'+encodeURIComponent(it.id));
      const p=d.product;
      const sz=it.size||null;
      let avail=p.stock;
      if(sz && (p.sizes||[]).length){
        const row=p.sizes.find(x=>x.size.toLowerCase()===String(sz).toLowerCase());
        avail=row?row.stock:0;
      }
      const q=Math.min(it.qty||1, p.allowBackorder?20:Math.max(1,avail));
      if(!(avail>0||p.allowBackorder)) continue;
      valid.push(sz?{id:p.id, qty:q, size:sz}:{id:p.id, qty:q});
      subtotal += p.effPrice*q;
      box.insertAdjacentHTML('beforeend', `<div class="citem">
        <a href="/product/${p.slug}"><img src="${H.esc(p.cover)}" alt="${H.esc(p.name)}" onerror="this.src='/images/logo.png'"></a>
        <div><a href="/product/${p.slug}"><h3>${H.esc(p.name)}</h3></a>
          <div class="m">${p.type==='poster'?`Set ${H.esc(p.setNo)} • 6 posters`:p.type==='combo'?`${(p.bundleItems||[]).length} items`:'Apparel'}${sz?` • Size <b class="szchip">${H.esc(sz)}</b>`:''} • ${H.money(p.effPrice)} each</div>
          <div class="miniqty"><button onclick="CQTY('${p.id}',-1,${JSON.stringify(sz)})">−</button><b>${q}</b><button onclick="CQTY('${p.id}',1,${JSON.stringify(sz)})">+</button></div>
        </div>
        <div class="r"><b>${H.money(p.effPrice*q)}</b><button class="rm" onclick="CRM('${p.id}',${JSON.stringify(sz)})">Remove</button></div>
      </div>`);
    }catch(e){ /* product removed/unpublished — drop */ }
  }
  H.setCart(valid);
  if(!valid.length){ render(); return; }
  const del=H.settings.delivery;
  sum.innerHTML = `
    <div class="sumrow"><span>Subtotal</span><span>${H.money(subtotal)}</span></div>
    <div class="sumrow"><span>Delivery (Inside Dhaka)</span><span>${H.money(del.inside)}</span></div>
    <div class="sumrow"><span>Delivery (Outside Dhaka)</span><span>${H.money(del.outside)}</span></div>
    <div class="sumrow total"><span>Total*</span><span>${H.money(subtotal+del.inside)}+</span></div>
    <p style="font-size:12.5px;color:var(--dim);margin:8px 0 16px">*Final total with delivery is calculated at checkout.</p>
    <a class="btn btn-lime btn-block" href="/checkout">Checkout →</a>
    <a class="btn btn-ghost btn-block" style="margin-top:10px" href="/shop">Continue shopping</a>`;
}
const same=(i,id,sz)=>i.id===id && (i.size||null)===(sz||null);
window.CQTY = (id,dd,sz=null) => { const c=H.getCart(); const f=c.find(i=>same(i,id,sz)); if(!f) return;
  f.qty=(f.qty||1)+dd; if(f.qty<1) H.setCart(c.filter(i=>!same(i,id,sz))); else { f.qty=Math.min(20,f.qty); H.setCart(c); } render(); };
window.CRM = (id,sz=null) => { H.setCart(H.getCart().filter(i=>!same(i,id,sz))); H.toast('Removed from cart'); render(); };
render();
})();
