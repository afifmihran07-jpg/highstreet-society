'use strict';
/* Poster exhibition: catalogue sync, admin order/hide/restore, poster info.
   Run: node --test tests/exhibition.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./_harness');

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'exhibition-defaults.json'), 'utf8')).posters;
const pub = s => s.json('/api/exhibition').then(r => r.data);
const adm = s => s.json('/api/admin/exhibition', { admin: true }).then(r => r.data);
const save = (s, body) => s.json('/api/admin/exhibition', { method: 'PUT', admin: true, body });

test('defaults file: one entry per live poster, 8–20 words, no duplicates', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8')); // shape only
  const entries = Object.entries(DEFAULTS);
  assert.ok(entries.length >= 6, 'has descriptions');
  for (const [url, d] of entries) {
    const n = d.text.split(/\s+/).length;
    assert.ok(n >= 8 && n <= 20, `${d.set} #${d.n}: ${n} words`);
    assert.ok(d.title && d.title.length <= 60);
    assert.match(url, /^https:\/\//);
  }
  assert.equal(new Set(entries.map(([, d]) => d.text)).size, entries.length, 'every description is unique');
  assert.ok(snap.products.length);
});

test('every eligible set becomes one slide with only its own posters; counts are dynamic', async t => {
  const s = await startServer();
  t.after(s.stop);
  const products = (await s.json('/api/products?limit=100')).data.items;
  const ex = await pub(s);
  assert.equal(ex.enabled, true);
  assert.equal(ex.sets.length, products.filter(p => (p.posters || []).length).length);
  for (const set of ex.sets) {
    const p = products.find(x => x.id === set.id);
    assert.deepEqual(set.posters.map(x => x.url), [...new Set(p.posters)], set.slug + ' shows exactly its own posters');
    assert.equal(set.slug, p.slug);
  }
  assert.equal((await s.json('/api/content/_exhibition')).status, 404, 'settings are internal');
});

test('admin order, hide and restore persist (also after a restart); shop order is untouched', async t => {
  const s = await startServer();
  t.after(s.stop);
  const shopBefore = (await s.json('/api/products?limit=100&sort=featured')).data.items.map(p => p.id);
  const ids = (await adm(s)).sets.filter(x => x.published).map(x => x.id);   // unpublished never show publicly
  const order = [ids[3], ids[0], ids[2], ids[1], ...ids.slice(4)];
  assert.equal((await save(s, { order, hidden: [ids[2]] })).status, 200);
  let ex = await pub(s);
  assert.deepEqual(ex.sets.map(x => x.id), order.filter(id => id !== ids[2]), 'public follows saved order, hidden left out');
  assert.equal((await adm(s)).sets.find(x => x.id === ids[2]).position, null);
  // restore → back in its previous slot
  assert.equal((await save(s, { hidden: [] })).status, 200);
  ex = await pub(s);
  assert.deepEqual(ex.sets.slice(0, 4).map(x => x.id), order.slice(0, 4), 'restored set is back at position 3');
  assert.deepEqual((await s.json('/api/products?limit=100&sort=featured')).data.items.map(p => p.id), shopBefore, 'shop order unchanged');
  // restart from the saved data file
  const saved = JSON.parse(fs.readFileSync(s.dataFile, 'utf8'));
  const s2 = await startServer({}, db => Object.assign(db, saved));
  t.after(s2.stop);
  assert.deepEqual((await pub(s2)).sets.map(x => x.id), order, 'order survives a restart');
});

test('new published sets are appended automatically; unpublished sets leave but keep their settings', async t => {
  const s = await startServer();
  t.after(s.stop);
  const before = (await pub(s)).sets.map(x => x.id);
  const custom = [before[1], before[0], ...before.slice(2)];
  await save(s, { order: custom, labels: { [before[0]]: 'Custom Label' } });
  const posters = Array.from({ length: 6 }, (_, i) => `/images/products/new-${i}.webp`);
  const r = await s.json('/api/admin/products', { method: 'POST', admin: true, body: { name: 'Brand New Set', price: 420, stock: 10,
    cover: posters[0], posters, published: true, type: 'poster', categoryIds: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const newId = r.data.product.id;
  let ex = await pub(s);
  assert.deepEqual(ex.sets.map(x => x.id), [...custom, newId], 'new set appended at the end, saved order kept');
  assert.equal(ex.sets.at(-1).posters.length, 6);
  assert.equal(ex.sets.find(x => x.id === before[0]).name, 'Custom Label', 'exhibition label (product name unchanged)');
  assert.notEqual((await s.json('/api/products/' + ex.sets.find(x => x.id === before[0]).slug)).data.product.name, 'Custom Label');
  // unpublish via bulk → disappears publicly, settings preserved
  await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids: [before[0]], action: 'hide' } });
  ex = await pub(s);
  assert.ok(!ex.sets.some(x => x.id === before[0]));
  const a = (await adm(s)).sets.find(x => x.id === before[0]);
  assert.equal(a.published, false); assert.equal(a.label, 'Custom Label');
  await s.json('/api/admin/products/bulk', { method: 'POST', admin: true, body: { ids: [before[0]], action: 'publish' } });
  assert.equal((await pub(s)).sets[1].id, before[0], 'republished set returns to its saved slot');
});

test('poster info: defaults by image URL, admin overrides, restore default, graceful empty', async t => {
  const [url, def] = Object.entries(DEFAULTS)[0];
  let pid;
  const s = await startServer({}, db => { const p = db.products.find(x => x.published); p.posters[0] = url; pid = p.id; });
  t.after(s.stop);
  let set = (await pub(s)).sets.find(x => x.id === pid);
  assert.equal(set.posters[0].text, def.text, 'shipped default used');
  assert.equal(set.posters[1].text, '', 'unknown poster: empty text (UI falls back)');
  const own = set.posters[1].url;
  assert.equal((await save(s, { info: { [pid]: { [own]: { title: 'My Title', text: 'Hand written by the admin for this exact poster on the wall.' } } } })).status, 200);
  set = (await pub(s)).sets.find(x => x.id === pid);
  assert.equal(set.posters[1].title, 'My Title');
  assert.equal(set.posters[0].text, def.text, 'other posters unaffected');
  // override a default, then restore it by clearing the override
  await save(s, { info: { [pid]: { [url]: { title: '', text: 'Admin override replacing the shipped default text here.' } } } });
  assert.match((await pub(s)).sets.find(x => x.id === pid).posters[0].text, /Admin override/);
  await save(s, { info: { [pid]: { [url]: { title: '', text: '' } } } });
  assert.equal((await pub(s)).sets.find(x => x.id === pid).posters[0].text, def.text, 'restored to default');
  // validation
  assert.equal((await save(s, { info: { [pid]: { 'https://evil.example/x.png': { text: 'nope nope nope nope' } } } })).status, 400);
  assert.equal((await save(s, { info: { [pid]: { [own]: { text: 'x'.repeat(200) } } } })).status, 400);
});

test('exhibition switch and admin-only access', async t => {
  const s = await startServer();
  t.after(s.stop);
  assert.equal((await s.json('/api/admin/exhibition')).status, 401);
  assert.equal((await s.json('/api/admin/exhibition', { method: 'PUT', body: { enabled: false } })).status, 401);
  await save(s, { enabled: false });
  assert.deepEqual(await pub(s), { enabled: false, sets: [] });
  await save(s, { enabled: true });
  assert.ok((await pub(s)).sets.length > 0);
});
