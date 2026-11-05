'use strict';
/* Phase 3: promotions, bulk product actions, editable homepage copy.
   Run: node --test tests/phase3.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./_harness');

const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bd-geo.json'), 'utf8'));
const DHAKA_AREA = GEO.find(d => d.name === 'Dhaka').districts.find(d => d.name === 'Dhaka').areas[0];
const HOUR = 3600e3;
// Two plain poster sets with known prices: A (no own sale) and B (own sale 300) in different categories.
const fixture = db => {
  const ps = db.products.filter(p => p.published && !(p.sizes || []).length);
  Object.assign(ps[0], { price: 420, salePrice: null, stock: 50, categoryIds: ['cat-a'] });
  Object.assign(ps[1], { price: 420, salePrice: 300, stock: 50, categoryIds: ['cat-b'] });
  db.categories.push({ id: 'cat-a', slug: 'cat-a', name: 'Cat A', sort: 90, visible: true, createdAt: 1 },
                     { id: 'cat-b', slug: 'cat-b', name: 'Cat B', sort: 91, visible: true, createdAt: 1 });
  fixture.A = ps[0]; fixture.B = ps[1];
};
const product = async (s, p) => (await s.json('/api/products/' + p.slug)).data.product;
const savePromos = (s, promotions) => s.json('/api/admin/promotions', { method: 'PUT', admin: true, body: { promotions } });

test('promotions: running % sale lowers prices everywhere incl. the order total; own lower sale price wins', async t => {
  const s = await startServer({}, fixture);
  t.after(s.stop);
  const r = await savePromos(s, [{ name: 'Eid Sale', type: 'percent', value: 20, banner: 'EID SALE • 20% OFF' }]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const a = await product(s, fixture.A), b = await product(s, fixture.B);
  assert.equal(a.effPrice, 336); assert.equal(a.discountPct, 20); assert.equal(a.promo.name, 'Eid Sale');
  assert.equal(a.salePrice, null, 'own salePrice is not overwritten by the promotion');
  assert.equal(b.effPrice, 300, 'own sale 300 < promo 336');
  const st = (await s.json('/api/settings')).data;
  assert.equal(st.promo.banner, 'EID SALE • 20% OFF');
  const order = await s.json('/api/orders', { method: 'POST', body: { name: 'Promo Test', mobile: '01712345678',
    division: 'Dhaka', district: 'Dhaka', area: DHAKA_AREA, address: 'House 1, Road 2', paymentMethod: 'cod',
    items: [{ id: fixture.A.id, qty: 2 }] } });
  assert.equal(order.status, 200, JSON.stringify(order.data));
  assert.equal(order.data.order.subtotal, 672, 'server charges the promotion price');
});

test('promotions: scheduled/paused/ended do not apply; category scope; internal storage is not public', async t => {
  const s = await startServer({}, fixture);
  t.after(s.stop);
  const now = Date.now();
  assert.equal((await savePromos(s, [
    { name: 'Future', type: 'percent', value: 50, startsAt: now + 24 * HOUR, banner: 'SECRET FUTURE SALE' },
    { name: 'Paused', type: 'percent', value: 50, active: false },
    { name: 'Over', type: 'flat', value: 100, startsAt: now - 48 * HOUR, endsAt: now - HOUR },
    { name: 'Cat B only', type: 'flat', value: 150, categoryIds: ['cat-b'] }
  ])).status, 200);
  assert.equal((await product(s, fixture.A)).effPrice, 420, 'nothing running applies to A');
  assert.equal((await product(s, fixture.B)).effPrice, 270, 'category promo 420-150 beats own sale 300');
  assert.equal((await s.json('/api/settings')).data.promo, null, 'no banner from future/paused promos');
  assert.equal((await s.json('/api/content/_promotions')).status, 404);
  const admin = await s.json('/api/admin/content', { admin: true });
  assert.ok(!('_promotions' in admin.data.content));
  assert.equal((await s.json('/api/admin/content/_promotions', { method: 'PUT', admin: true, body: { body: '[]' } })).status, 400);
  const list = (await s.json('/api/admin/promotions', { admin: true })).data.promotions;
  assert.deepEqual(list.map(p => p.status), ['scheduled', 'paused', 'ended', 'running']);
});

test('promotions: validation and admin-only access', async t => {
  const s = await startServer({}, fixture);
  t.after(s.stop);
  assert.equal((await s.json('/api/admin/promotions')).status, 401);
  assert.equal((await s.json('/api/admin/promotions', { method: 'PUT', body: { promotions: [] } })).status, 401);
  for (const bad of [{ name: 'x', value: 0 }, { name: 'x', value: 95 }, { name: '', value: 10 },
                     { name: 'x', value: 10, startsAt: 2000, endsAt: 1000 }]) {
    assert.equal((await savePromos(s, [bad])).status, 400, JSON.stringify(bad));
  }
  // flat promo larger than the price never goes below ৳1
  assert.equal((await savePromos(s, [{ name: 'Huge', type: 'flat', value: 5000 }])).status, 200);
  assert.equal((await product(s, fixture.A)).effPrice, 1);
});

test('bulk actions: apply to selected sets; a failing action changes nothing; admin-only', async t => {
  const s = await startServer({}, fixture);
  t.after(s.stop);
  const ids = [fixture.A.id, fixture.B.id];
  assert.equal((await s.json('/api/admin/products/bulk', { method: 'POST', body: { ids, action: 'hide' } })).status, 401);
  let r = await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'salePercent', value: 10 } });
  assert.equal(r.status, 200); assert.equal(r.data.updated, 2);
  assert.equal((await product(s, fixture.A)).effPrice, 378);
  // 400 is not below B's price 420? it is; 500 is not -> whole action refused, A untouched
  r = await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'sale', value: 500 } });
  assert.equal(r.status, 400);
  assert.equal((await product(s, fixture.A)).effPrice, 378, 'nothing half-applied');
  r = await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'price', value: 450 } });
  assert.equal(r.status, 200);
  const a = await product(s, fixture.A);
  assert.equal(a.price, 450); assert.equal(a.effPrice, 378, 'sale kept because still below new price');
  r = await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'addCategory', value: 'cat-a' } });
  assert.deepEqual((await product(s, fixture.B)).categoryIds.sort(), ['cat-a', 'cat-b']);
  assert.equal((await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'addCategory', value: 'nope' } })).status, 400);
  assert.equal((await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids, action: 'rm -rf' } })).status, 400);
  r = await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids: [fixture.A.id], action: 'hide' } });
  assert.equal((await s.json('/api/products/' + fixture.A.slug)).status, 404, 'hidden set is no longer public');
});

test('homepage copy blocks are stored, capped and served', async t => {
  const s = await startServer();
  t.after(s.stop);
  const r = await s.json('/api/admin/homepage', { method: 'PUT', admin: true, body: {
    hero: { line1: 'SIX POSTERS.', tagline: 'A4 • 3MM', strip: 'PREMIUM A4' },
    blocks: { marquee: Array.from({ length: 12 }, (_, i) => 'MSG ' + i), perks: [{ title: 'T', text: 'x'.repeat(500) }, { title: '' }],
      sections: { new: { title: 'Fresh sets', sub: 'sub' } }, insta: { title: 'Follow', text: 'Hi' }, evil: { x: 1 } } } });
  assert.equal(r.status, 200);
  const h = (await s.json('/api/homepage')).data.hero;
  assert.equal(h.line1, 'SIX POSTERS.'); assert.equal(h.tagline, 'A4 • 3MM'); assert.equal(h.strip, 'PREMIUM A4');
  assert.equal(h.blocks.marquee.length, 8);
  assert.equal(h.blocks.perks.length, 1); assert.equal(h.blocks.perks[0].text.length, 160);
  assert.equal(h.blocks.sections.new.title, 'Fresh sets'); assert.equal(h.blocks.sections.best.title, '');
  assert.equal(h.blocks.evil, undefined);
});
