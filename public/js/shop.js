/* HSS shop page */
(async function(){
await HSS.renderLayout('shop');
const H = HSS;
const qs = new URLSearchParams(location.search);
const SORTS = ['newest','popular','featured','price-asc','price-desc','name'];
const state = { q:qs.get('q')||'', cat:qs.get('cat')||'', sort:SORTS.includes(qs.get('sort'))?qs.get('sort'):'newest',
  avail:qs.get('avail')==='1'?'1':'', page:1, pages:1, filter:qs.get('filter')||'' };
document.getElementById('q').value = state.q;
if(!qs.get('sort') && state.filter==='best') state.sort='popular';
document.getElementById('sort').value = state.sort;
document.getElementById('avail').value = state.avail;
// Keep filters in the address bar: shareable links, and Back returns to the same view.
function syncUrl(){
  const p = new URLSearchParams();
  if(state.q) p.set('q', state.q);
  if(state.cat) p.set('cat', state.cat);
  if(state.filter) p.set('filter', state.filter);
  if(state.sort!=='newest') p.set('sort', state.sort);
  if(state.avail) p.set('avail', '1');
  const u = '/shop' + (p.toString() ? '?' + p : '');
  if(u !== location.pathname + location.search) history.replaceState(null, '', u);
}

const cats = await H.loadCats();
const chips = document.getElementById('catchips');
const head = document.querySelector('.shophead');
function renderHead(){
  const c = cats.find(x=>x.id===state.cat);
  const t = c ? c.name : state.filter==='new' ? 'New arrivals' : state.filter==='best' ? 'Best sellers' : 'All poster sets';
  head.querySelector('h1').textContent = t.toUpperCase();
  let d = head.querySelector('.catdesc');
  if(!d){ d = document.createElement('p'); d.className = 'catdesc'; head.querySelector('h1').after(d); }
  d.textContent = c && c.description ? c.description : '';
  d.hidden = !d.textContent;
  document.title = (c ? c.name + ' Poster Sets' : t) + ' — Highstreet Society';
}
function renderChips(){
  renderHead();
  chips.innerHTML = (state.filter?`<button class="chip on" data-f="">${state.filter==='new'?'New arrivals':'Best sellers'} ✕</button>`:'') + `<button class="chip ${!state.cat?'on':''}" data-c="">All</button>` +
    cats.map(c=>`<button class="chip ${state.cat===c.id?'on':''}" data-c="${c.id}">${H.esc(c.name)}</button>`).join('');
  chips.querySelectorAll('button[data-c]').forEach(b=>b.onclick=()=>{ state.cat=b.dataset.c; state.page=1; renderChips(); load(); });
  chips.querySelectorAll('button[data-f]').forEach(b=>b.onclick=()=>{ state.filter=''; state.page=1; renderChips(); load(); });
}
renderChips();

let timer=null;
document.getElementById('q').addEventListener('input', e=>{ clearTimeout(timer); timer=setTimeout(()=>{ state.q=e.target.value.trim(); state.page=1; load(); },350); });
document.getElementById('sort').addEventListener('change', e=>{ state.sort=e.target.value; state.page=1; load(); });
document.getElementById('avail').addEventListener('change', e=>{ state.avail=e.target.value; state.page=1; load(); });

async function load(append=false){
  if(!append) syncUrl();
  const grid=document.getElementById('grid'), more=document.getElementById('more');
  if(!append) grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="e"><span class="spin" aria-hidden="true"></span></div><h3>Loading sets…</h3></div>`;
  const p = new URLSearchParams({ page:state.page, limit:24, sort:state.sort });
  if(state.q) p.set('q',state.q);
  if(state.cat) p.set('category',state.cat);
  if(state.avail) p.set('inStock','1');
  if(state.filter==='new') p.set('isNew','1');
  if(state.filter==='best') p.set('bestseller','1');
  try{
    const d = await H.api('/api/products?'+p.toString());
    state.pages=d.pages;
    document.getElementById('count').textContent = d.total? `${d.total} set${d.total>1?'s':''} • 6 posters in every set` : '';
    if(!append) grid.innerHTML='';
    if(!d.items.length && !append){
      grid.innerHTML = H.empty('🔍','No sets found','Try a different search or category.','<button class="btn btn-lime" onclick="location.href=\'/shop\'">Clear filters</button>');
      more.innerHTML=''; return;
    }
    grid.insertAdjacentHTML('beforeend', d.items.map(H.card).join(''));
    more.innerHTML = state.page<d.pages ? `<button class="btn btn-ghost" id="loadmore">Load more (${d.total - state.page*24} left)</button>` : '';
    const lm=document.getElementById('loadmore');
    if(lm) lm.onclick=()=>{ state.page++; load(true); };
  }catch(e){
    if(!append) grid.innerHTML = H.empty('😕','Could not load products','Please refresh and try again.');
  }
}
load();
})();
