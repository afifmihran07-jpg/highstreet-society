/* HSS custom design requests */
(async function(){
const H = HSS;
await H.renderLayout('');
const el = document.getElementById('content');

const HEAD = `<div class="shophead"><h1>CUSTOM <span class="l">DESIGN</span></h1>
  <p>Got your own artwork, photo or idea? We'll print it on premium board or apparel.</p></div>`;

function loginGate(){
  el.innerHTML = HEAD + `
  <div class="panel" style="max-width:520px;margin:0 auto;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">🎨</div>
    <h2 style="margin-bottom:6px">Login to send a request</h2>
    <p style="color:var(--dim);margin-bottom:18px">We need an account so you can track your request and we can reach you about pricing.</p>
    <a class="btn btn-lime btn-block" href="/account?next=/custom-design">Login or create account →</a>
    <a class="btn btn-ghost btn-block" style="margin-top:10px" href="/shop">Browse ready-made sets</a>
  </div>`;
}

const STATUS_TEXT = {
  submitted:'We have received your request',
  reviewing:'Our team is reviewing your design',
  quoted:'We have sent you a price quote',
  approved:'Approved — going to production',
  'in-production':'Your custom order is being made',
  completed:'Completed',
  rejected:'Could not proceed — see our note'
};

async function main(){
  el.innerHTML = HEAD + `
  <div class="split">
    <div class="panel">
      <h2>1 • Tell us what you need</h2>
      <div class="fld"><label>What should we make? *</label>
        <select id="d_type">
          <option value="">Select a product type</option>
          <option>Custom poster set (6 posters)</option>
          <option>Single custom poster</option>
          <option>Custom t-shirt</option>
          <option>Custom hoodie</option>
          <option>Custom combo / bundle</option>
          <option>Other (explain below)</option>
        </select></div>
      <div class="fgrid2">
        <div class="fld"><label>Quantity *</label><input id="d_qty" type="number" min="1" value="1" inputmode="numeric"></div>
        <div class="fld"><label>Best contact (mobile/WhatsApp) *</label><input id="d_contact" inputmode="tel" placeholder="01XXXXXXXXX"></div>
      </div>
      <div class="fld"><label>Describe your design *</label>
        <textarea id="d_details" rows="5" placeholder="Colours, theme, text to include, size, reference links — the more detail the better."></textarea></div>
      <div class="fld" style="margin-bottom:0"><label>Upload your artwork (optional — up to 5 images or PDF)</label>
        <input id="d_files" type="file" accept="image/*,application/pdf" multiple>
        <div id="d_prev" class="dprev"></div></div>
      <button class="btn btn-lime btn-block" id="d_send" style="margin-top:16px">Submit request →</button>
      <p style="font-size:12.5px;color:var(--dim);margin-top:10px;text-align:center">No payment now — we'll review and send you a price first.</p>
    </div>
    <div>
      <div class="panel" style="margin-bottom:16px">
        <h2>How it works</h2>
        <ol class="hownum">
          <li><b>Send your idea</b><span>Upload artwork or just describe it.</span></li>
          <li><b>We review &amp; quote</b><span>Our team checks print quality and messages you a price.</span></li>
          <li><b>You approve</b><span>Pay via bKash/Nagad or COD once confirmed.</span></li>
          <li><b>We print &amp; deliver</b><span>Made on 3mm board or premium fabric, delivered nationwide.</span></li>
        </ol>
      </div>
      <div class="panel"><h2>My requests</h2><div id="mylist"><p style="color:var(--mut)">Loading…</p></div></div>
    </div>
  </div>`;

  const filesEl = document.getElementById('d_files');
  filesEl.onchange = () => {
    const box=document.getElementById('d_prev');
    const fs=[...filesEl.files].slice(0,5);
    if(fs.length>5) H.toast('Maximum 5 files');
    box.innerHTML = fs.map(f=>`<span class="dchip">${H.esc(f.name)} <i>${Math.round(f.size/1024)}KB</i></span>`).join('');
  };

  document.getElementById('d_send').onclick = async () => {
    const btn=document.getElementById('d_send');
    const productType=document.getElementById('d_type').value;
    const details=document.getElementById('d_details').value.trim();
    const contact=document.getElementById('d_contact').value.trim();
    const quantity=document.getElementById('d_qty').value;
    if(!productType) return H.toast('Please choose what you want designed');
    if(details.length<10) return H.toast('Please describe your design idea');
    if(!/^01[3-9]\d{8}$/.test(contact)) return H.toast('Please enter a valid 11-digit mobile number');
    const fd=new FormData();
    fd.append('productType',productType); fd.append('details',details);
    fd.append('contact',contact); fd.append('quantity',quantity);
    [...filesEl.files].slice(0,5).forEach(f=>fd.append('files',f));
    btn.disabled=true; btn.textContent='Sending…';
    try{
      await H.api('/api/designs',{method:'POST',body:fd});
      H.toast('Request sent! We will contact you soon.',true);
      document.getElementById('d_details').value='';
      document.getElementById('d_type').value='';
      filesEl.value=''; document.getElementById('d_prev').innerHTML='';
      loadMine();
    }catch(e){ H.toast(e.message); }
    btn.disabled=false; btn.textContent='Submit request →';
  };

  async function loadMine(){
    const box=document.getElementById('mylist');
    try{
      const d=await H.api('/api/designs/mine');
      if(!d.designs.length){ box.innerHTML='<p style="color:var(--mut)">You have not sent any custom requests yet.</p>'; return; }
      box.innerHTML=d.designs.map(x=>`<div class="dreq">
        <div class="dtop"><b>${H.esc(x.id)}</b>${H.statusPill(x.status)}</div>
        <div class="dmeta">${H.esc(x.productType)} • Qty ${x.quantity}</div>
        <p>${H.esc(x.details).slice(0,150)}${x.details.length>150?'…':''}</p>
        ${x.files.length?`<div class="dfiles">${x.files.map(f=>`<a href="${H.esc(f)}" target="_blank" rel="noopener">file</a>`).join('')}</div>`:''}
        ${x.quote!=null?`<div class="dquote">Quoted price: <b>${H.money(x.quote)}</b></div>`:''}
        ${x.adminNote?`<div class="dnote">${H.esc(x.adminNote)}</div>`:''}
        <span class="dstat">${H.esc(STATUS_TEXT[x.status]||x.status)}</span>
      </div>`).join('');
    }catch(e){ box.innerHTML='<p style="color:var(--mut)">Could not load your requests.</p>'; }
  }
  loadMine();
}

if(!H.loggedIn()) return loginGate();
try{ await H.api('/api/auth/me'); main(); }
catch(e){ HSS.store.remove('hss_token'); loginGate(); }
})();
