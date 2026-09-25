'use strict';

/*
 * Highstreet Society PostgreSQL persistence adapter.
 *
 * The existing server keeps its normal in-memory `db` object. This module only
 * changes durable persistence when DATABASE_URL is present.
 *
 * Flow:
 *   server mutation -> saveDB() -> transaction -> advisory lock
 *   -> UPSERT current rows -> delete only previously-known removed rows
 *   -> COMMIT
 *
 * The PostgreSQL schema is intentionally not created here, and data/db.json
 * is read-only backup/fallback data.
 */

const fs = require('fs');

let pg;
function getPg() {
  if (!pg) {
    try { pg = require('pg'); }
    catch (_) { throw new Error('PostgreSQL support requires the "pg" package. Run: npm install pg'); }
  }
  return pg;
}

const REQUIRED_TABLES = [
  'customers', 'categories', 'products', 'product_categories', 'orders', 'order_items',
  'reviews', 'coupons', 'carts', 'designs', 'content_pages', 'app_settings',
  'homepage_config', 'sessions', 'revoked_tokens', 'hss_meta'
];

// A stable 32-bit application-wide lock identifier.
const ADVISORY_LOCK_KEY = 1864823519;
let lastPersistedState = null;

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function arr(v) { return Array.isArray(v) ? v : []; }
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function json(v) { return JSON.stringify(v === undefined ? null : v); }
function sameJson(a, b) { return json(a) === json(b); }

function msToDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const n = Number(v);
  if (Number.isFinite(n)) return new Date(n);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function dateToMs(v) {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  const n = d.getTime();
  return Number.isFinite(n) ? n : null;
}

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Unsafe SQL identifier');
  return '"' + name + '"';
}

function createPool() {
  const { Pool } = getPg();
  if (!process.env.DATABASE_URL) return null;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    allowExitOnIdle: false,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false }
  });
}

async function schemaExists(pool) {
  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY($1::text[])
  `, [REQUIRED_TABLES]);
  const found = new Set(rows.map(r => r.table_name));
  return REQUIRED_TABLES.every(t => found.has(t));
}

async function databaseEmpty(client) {
  for (const table of REQUIRED_TABLES) {
    const { rows } = await client.query(`SELECT count(*)::bigint AS count FROM ${quoteIdent(table)}`);
    if (Number(rows[0].count) !== 0) return false;
  }
  return true;
}

function normalizeDb(raw) {
  const db = clone(raw || {});
  db.meta = obj(db.meta);
  db.settings = obj(db.settings);
  db.categories = arr(db.categories);
  db.products = arr(db.products);
  db.customers = arr(db.customers);
  db.sessions = obj(db.sessions);
  db.designs = arr(db.designs);
  db.orders = arr(db.orders);
  db.reviews = arr(db.reviews);
  db.carts = arr(db.carts);
  db.content = obj(db.content);
  db.coupons = arr(db.coupons);
  db.homepage = obj(db.homepage);
  db.revoked = obj(db.revoked);
  db.meta.orderSeq = Number(db.meta.orderSeq || 1001);
  db.meta.productSeq = Number(db.meta.productSeq || 180);
  db.meta.customerSeq = Number(db.meta.customerSeq || 1);
  db.meta.designSeq = Number(db.meta.designSeq || 1001);
  db.customers.forEach(c => {
    for (const k of ['address','area','division','district','locality','landmark']) {
      if (c[k] === undefined) c[k] = '';
    }
  });
  return db;
}

async function loadState(pool) {
  const q = async sql => (await pool.query(sql)).rows;
  const db = {
    meta:{}, settings:{}, categories:[], products:[], customers:[], sessions:{},
    designs:[], orders:[], reviews:[], carts:[], content:{}, coupons:[], homepage:{}, revoked:{}
  };

  for (const r of await q('SELECT key,value FROM hss_meta')) {
    db.meta[r.key] = Number.isFinite(Number(r.value)) ? Number(r.value) : r.value;
  }

  const settings = await q('SELECT * FROM app_settings WHERE id=1');
  if (settings[0]) {
    const s = settings[0];
    db.settings = {
      brand:obj(s.brand), contact:obj(s.contact), delivery:obj(s.delivery),
      payments:obj(s.payments), admin:obj(s.admin), seo:obj(s.seo),
      announcement:s.announcement || '', lowStockAt:Number(s.low_stock_at || 5),
      sessionSecret:s.session_secret || ''
    };
  }

  for (const r of await q('SELECT * FROM categories ORDER BY sort ASC,created_at ASC')) {
    db.categories.push({ id:r.id, slug:r.slug, name:r.name, description:r.description||'',
      image:r.image||'', sort:Number(r.sort||0), visible:r.visible!==false, createdAt:dateToMs(r.created_at) });
  }

  const productRows = await q('SELECT * FROM products ORDER BY sort ASC,created_at DESC');
  const pcRows = await q('SELECT product_id,category_id FROM product_categories');
  const catMap = {};
  for (const r of pcRows) (catMap[r.product_id] ||= []).push(r.category_id);
  for (const r of productRows) {
    db.products.push({
      id:r.id, slug:r.slug, setNo:r.set_no, views:Number(r.views||0), sold:Number(r.sold||0),
      createdAt:dateToMs(r.created_at), updatedAt:dateToMs(r.updated_at), name:r.name,
      short:r.short||'', description:r.description||'', price:Number(r.price||0),
      salePrice:r.sale_price===null?null:Number(r.sale_price), stock:Number(r.stock||0), sku:r.sku||'',
      categoryIds:catMap[r.id]||[], tags:arr(r.tags), cover:r.cover||'', posters:arr(r.posters),
      type:r.type||'poster', sizes:arr(r.sizes), bundleItems:arr(r.bundle_items),
      posterSize:r.poster_size||'A4', boardThickness:r.board_thickness||'3mm', featured:!!r.featured,
      isNew:!!r.is_new, bestseller:!!r.bestseller, published:!!r.published,
      allowBackorder:!!r.allow_backorder, sort:Number(r.sort||0), seoTitle:r.seo_title||'', seoDesc:r.seo_desc||''
    });
  }

  for (const r of await q('SELECT * FROM customers ORDER BY created_at ASC')) {
    db.customers.push({ id:r.id, name:r.name, mobile:r.mobile, salt:r.salt, passHash:r.pass_hash,
      address:r.address||'', area:r.area||'', division:r.division||'', district:r.district||'',
      locality:r.locality||'', landmark:r.landmark||'', createdAt:dateToMs(r.created_at) });
  }

  for (const r of await q('SELECT token,type,entity_id,created_at FROM sessions')) {
    db.sessions[r.token] = { type:r.type, id:r.entity_id, createdAt:dateToMs(r.created_at) };
  }
  for (const r of await q('SELECT token,revoked_at FROM revoked_tokens')) {
    db.revoked[r.token] = dateToMs(r.revoked_at);
  }

  const orderRows = await q('SELECT * FROM orders ORDER BY created_at DESC');
  const itemRows = await q('SELECT * FROM order_items ORDER BY order_id,id');
  const itemsByOrder = {};
  for (const r of itemRows) {
    (itemsByOrder[r.order_id] ||= []).push({ productId:r.product_id, slug:r.slug, name:r.name,
      cover:r.cover, price:Number(r.price||0), qty:Number(r.qty||0), size:r.size||null, type:r.type||'poster' });
  }
  for (const r of orderRows) {
    db.orders.push({
      id:r.id, items:itemsByOrder[r.id]||[], subtotal:Number(r.subtotal||0), discount:Number(r.discount||0),
      coupon:r.coupon||null, zone:r.zone, deliveryCharge:Number(r.delivery_charge||0), total:Number(r.total||0),
      customer:{ name:r.customer_name||'', mobile:r.customer_mobile||'', address:r.customer_address||'',
        area:r.customer_area||'', district:r.customer_district||'', division:r.customer_division||'',
        locality:r.customer_locality||'', landmark:r.customer_landmark||'', customerId:r.customer_id||null },
      paymentMethod:r.payment_method, trxId:r.trx_id||null, paymentStatus:r.payment_status, status:r.status,
      notes:r.notes||'', createdAt:dateToMs(r.created_at), updatedAt:dateToMs(r.updated_at), history:arr(r.history)
    });
  }

  for (const r of await q('SELECT * FROM reviews ORDER BY created_at DESC')) {
    db.reviews.push({ id:r.id, productId:r.product_id, name:r.name, rating:Number(r.rating), text:r.text,
      approved:!!r.approved, createdAt:dateToMs(r.created_at) });
  }
  for (const r of await q('SELECT * FROM coupons ORDER BY created_at DESC')) {
    db.coupons.push({ code:r.code, type:r.type, value:Number(r.value||0), minOrder:Number(r.min_order||0),
      active:!!r.active, usage:Number(r.usage||0), createdAt:dateToMs(r.created_at) });
  }
  for (const r of await q('SELECT * FROM carts ORDER BY updated_at DESC')) {
    db.carts.push({ key:r.key, items:arr(r.items), value:Number(r.value||0), name:r.name||'', mobile:r.mobile||'',
      recovered:!!r.recovered, createdAt:dateToMs(r.created_at), updatedAt:dateToMs(r.updated_at) });
  }
  for (const r of await q('SELECT * FROM designs ORDER BY created_at DESC')) {
    db.designs.push({ id:r.id, customerId:r.customer_id, name:r.name, mobile:r.mobile, contact:r.contact||'',
      productType:r.product_type, quantity:Number(r.quantity||1), details:r.details||'', files:arr(r.files),
      status:r.status, quote:r.quote===null?null:Number(r.quote), adminNote:r.admin_note||'',
      createdAt:dateToMs(r.created_at), updatedAt:dateToMs(r.updated_at), history:arr(r.history) });
  }
  for (const r of await q('SELECT page_key,title,body,updated_at FROM content_pages')) {
    db.content[r.page_key] = { title:r.title||'', body:r.body||'', updatedAt:dateToMs(r.updated_at) };
  }

  const home = await q('SELECT * FROM homepage_config WHERE id=1');
  if (home[0]) {
    db.homepage = { hero:obj(home[0].hero), featuredIds:arr(home[0].featured_ids), newIds:arr(home[0].new_ids),
      bestsellerIds:arr(home[0].bestseller_ids), collectionCategoryIds:arr(home[0].collection_category_ids),
      perksTitle:home[0].perks_title||'', showSections:obj(home[0].show_sections) };
  }
  return normalizeDb(db);
}

function ids(list,key) { return new Set(arr(list).map(x=>x && x[key]).filter(x=>x!==undefined && x!==null)); }
function keys(value) { return new Set(Object.keys(obj(value))); }

async function deleteMissing(client, table, column, previous, current) {
  if (!previous) return;
  const currentSet = new Set(current);
  for (const oldValue of previous) {
    if (!currentSet.has(oldValue)) {
      await client.query(`DELETE FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)}=$1`, [oldValue]);
    }
  }
}

async function upsertMeta(client, db) {
  const previousMeta = lastPersistedState
    ? (lastPersistedState.meta || {})
    : null;

  for (const [key, value] of Object.entries(db.meta)) {
    const nextValue = String(value);

    if (
      previousMeta &&
      Object.prototype.hasOwnProperty.call(previousMeta, key) &&
      String(previousMeta[key]) === nextValue
    ) {
      continue;
    }

    await client.query(
      `INSERT INTO hss_meta(key,value) VALUES($1,$2)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      [key, nextValue]
    );
  }

  await deleteMissing(
    client,
    'hss_meta',
    'key',
    lastPersistedState
      ? keys(lastPersistedState.meta)
      : null,
    Object.keys(db.meta)
  );
}

async function upsertSettings(client, db) {
  const s = db.settings || {};
  const previous = lastPersistedState
    ? (lastPersistedState.settings || {})
    : null;

  const currentComparable = {
    brand: s.brand || {},
    contact: s.contact || {},
    delivery: s.delivery || {},
    payments: s.payments || {},
    admin: s.admin || {},
    seo: s.seo || {},
    announcement: s.announcement || '',
    lowStockAt: Number(s.lowStockAt || 5),
    sessionSecret: s.sessionSecret || ''
  };

  const previousComparable = previous
    ? {
        brand: previous.brand || {},
        contact: previous.contact || {},
        delivery: previous.delivery || {},
        payments: previous.payments || {},
        admin: previous.admin || {},
        seo: previous.seo || {},
        announcement: previous.announcement || '',
        lowStockAt: Number(previous.lowStockAt || 5),
        sessionSecret: previous.sessionSecret || ''
      }
    : null;

  if (
    previousComparable &&
    JSON.stringify(previousComparable) === JSON.stringify(currentComparable)
  ) {
    return;
  }

  await client.query(
    `INSERT INTO app_settings(
      id,brand,contact,delivery,payments,admin,seo,
      announcement,low_stock_at,session_secret
    )
    VALUES(
      1,$1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9
    )
    ON CONFLICT(id) DO UPDATE SET
      brand=EXCLUDED.brand,
      contact=EXCLUDED.contact,
      delivery=EXCLUDED.delivery,
      payments=EXCLUDED.payments,
      admin=EXCLUDED.admin,
      seo=EXCLUDED.seo,
      announcement=EXCLUDED.announcement,
      low_stock_at=EXCLUDED.low_stock_at,
      session_secret=EXCLUDED.session_secret`,
    [
      json(currentComparable.brand),
      json(currentComparable.contact),
      json(currentComparable.delivery),
      json(currentComparable.payments),
      json(currentComparable.admin),
      json(currentComparable.seo),
      currentComparable.announcement,
      currentComparable.lowStockAt,
      currentComparable.sessionSecret
    ]
  );
}
async function upsertCategories(client, db) {
  const previousCategories = new Map(
    lastPersistedState
      ? lastPersistedState.categories.map(c => [c.id, c])
      : []
  );

  for (const c of db.categories) {
    const previous = previousCategories.get(c.id);

    if (previous && JSON.stringify(previous) === JSON.stringify(c)) {
      continue;
    }

    await client.query(`
      INSERT INTO categories(
        id,slug,name,description,image,sort,visible,created_at
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(id) DO UPDATE SET
        slug=EXCLUDED.slug,
        name=EXCLUDED.name,
        description=EXCLUDED.description,
        image=EXCLUDED.image,
        sort=EXCLUDED.sort,
        visible=EXCLUDED.visible,
        created_at=EXCLUDED.created_at
    `, [
      c.id,
      c.slug || '',
      c.name || '',
      c.description || '',
      c.image || '',
      Number(c.sort || 0),
      c.visible !== false,
      msToDate(c.createdAt)
    ]);
  }

  await deleteMissing(
    client,
    'categories',
    'id',
    lastPersistedState ? ids(lastPersistedState.categories, 'id') : null,
    db.categories.map(c => c.id)
  );
}

async function upsertProducts(client, db) {
  const previousProducts = new Map(
    lastPersistedState
      ? lastPersistedState.products.map(p => [p.id, p])
      : []
  );

  for (const p of db.products) {
    const previous = previousProducts.get(p.id);

    if (previous && JSON.stringify(previous) === JSON.stringify(p)) {
      continue;
    }

    await client.query(`
      INSERT INTO products(
        id,slug,set_no,views,sold,created_at,updated_at,name,short,description,
        price,sale_price,stock,sku,tags,cover,posters,type,sizes,bundle_items,
        poster_size,board_thickness,featured,is_new,bestseller,published,
        allow_backorder,sort,seo_title,seo_desc
      )
      VALUES(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15::jsonb,$16,$17::jsonb,$18,$19::jsonb,$20::jsonb,$21,
        $22,$23,$24,$25,$26,$27,$28,$29,$30
      )
      ON CONFLICT(id) DO UPDATE SET
        slug=EXCLUDED.slug,
        set_no=EXCLUDED.set_no,
        views=EXCLUDED.views,
        sold=EXCLUDED.sold,
        created_at=EXCLUDED.created_at,
        updated_at=EXCLUDED.updated_at,
        name=EXCLUDED.name,
        short=EXCLUDED.short,
        description=EXCLUDED.description,
        price=EXCLUDED.price,
        sale_price=EXCLUDED.sale_price,
        stock=EXCLUDED.stock,
        sku=EXCLUDED.sku,
        tags=EXCLUDED.tags,
        cover=EXCLUDED.cover,
        posters=EXCLUDED.posters,
        type=EXCLUDED.type,
        sizes=EXCLUDED.sizes,
        bundle_items=EXCLUDED.bundle_items,
        poster_size=EXCLUDED.poster_size,
        board_thickness=EXCLUDED.board_thickness,
        featured=EXCLUDED.featured,
        is_new=EXCLUDED.is_new,
        bestseller=EXCLUDED.bestseller,
        published=EXCLUDED.published,
        allow_backorder=EXCLUDED.allow_backorder,
        sort=EXCLUDED.sort,
        seo_title=EXCLUDED.seo_title,
        seo_desc=EXCLUDED.seo_desc
    `, [
      p.id,
      p.slug,
      p.setNo || '',
      Number(p.views || 0),
      Number(p.sold || 0),
      msToDate(p.createdAt),
      msToDate(p.updatedAt),
      p.name,
      p.short || '',
      p.description || '',
      p.price,
      p.salePrice === undefined ? null : p.salePrice,
      Number(p.stock || 0),
      p.sku || '',
      json(arr(p.tags)),
      p.cover || '',
      json(arr(p.posters)),
      p.type || 'poster',
      json(arr(p.sizes)),
      json(arr(p.bundleItems)),
      p.posterSize || 'A4',
      p.boardThickness || '3mm',
      !!p.featured,
      !!p.isNew,
      !!p.bestseller,
      !!p.published,
      !!p.allowBackorder,
      Number(p.sort || 0),
      p.seoTitle || '',
      p.seoDesc || ''
    ]);
  }

  await deleteMissing(
    client,
    'products',
    'id',
    lastPersistedState ? ids(lastPersistedState.products, 'id') : null,
    db.products.map(p => p.id)
  );
}

function categoryEdges(db) {
  const categoryIds = new Set(db.categories.map(c => c.id));
  return db.products.flatMap(p =>
    arr(p.categoryIds)
      .filter(c => categoryIds.has(c))
      .map(c => [p.id, c])
  );
}

function edgeKey(e) {
  return e[0] + '\u0000' + e[1];
}

async function syncProductCategories(client, db) {
  const current = categoryEdges(db);
  const currentSet = new Set(current.map(edgeKey));

  const previous = lastPersistedState
    ? categoryEdges(lastPersistedState)
    : [];

  const previousSet = new Set(previous.map(edgeKey));

  for (const [productId, categoryId] of current) {
    const key = edgeKey([productId, categoryId]);

    if (previousSet.has(key)) {
      continue;
    }

    await client.query(
      `INSERT INTO product_categories(product_id,category_id)
       VALUES($1,$2)
       ON CONFLICT(product_id,category_id) DO NOTHING`,
      [productId, categoryId]
    );
  }

  for (const [productId, categoryId] of previous) {
    const key = edgeKey([productId, categoryId]);

    if (!currentSet.has(key)) {
      await client.query(
        `DELETE FROM product_categories
         WHERE product_id=$1 AND category_id=$2`,
        [productId, categoryId]
      );
    }
  }
}
async function upsertCustomers(client, db) {
  for (const c of db.customers) {
    await client.query(`INSERT INTO customers(id,name,mobile,salt,pass_hash,address,area,division,district,locality,landmark,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,mobile=EXCLUDED.mobile,salt=EXCLUDED.salt,
      pass_hash=EXCLUDED.pass_hash,address=EXCLUDED.address,area=EXCLUDED.area,division=EXCLUDED.division,
      district=EXCLUDED.district,locality=EXCLUDED.locality,landmark=EXCLUDED.landmark,created_at=EXCLUDED.created_at`,
      [c.id,c.name,c.mobile,c.salt,c.passHash,c.address||'',c.area||'',c.division||'',c.district||'',c.locality||'',c.landmark||'',msToDate(c.createdAt)]);
  }
  await deleteMissing(client,'customers','id',lastPersistedState ? ids(lastPersistedState.customers,'id') : null,db.customers.map(c=>c.id));
}

async function upsertOrders(client, db) {
  const customerIds=new Set(db.customers.map(c=>c.id));
  for (const o of db.orders) {
    const c=o.customer||{};
    const customerId=c.customerId && customerIds.has(c.customerId) ? c.customerId : null;
    await client.query(`INSERT INTO orders(id,customer_id,subtotal,discount,coupon,zone,delivery_charge,total,
      customer_name,customer_mobile,customer_address,customer_area,customer_district,customer_division,
      customer_locality,customer_landmark,payment_method,trx_id,payment_status,status,notes,created_at,updated_at,history)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb)
      ON CONFLICT(id) DO UPDATE SET customer_id=EXCLUDED.customer_id,subtotal=EXCLUDED.subtotal,discount=EXCLUDED.discount,
      coupon=EXCLUDED.coupon,zone=EXCLUDED.zone,delivery_charge=EXCLUDED.delivery_charge,total=EXCLUDED.total,
      customer_name=EXCLUDED.customer_name,customer_mobile=EXCLUDED.customer_mobile,customer_address=EXCLUDED.customer_address,
      customer_area=EXCLUDED.customer_area,customer_district=EXCLUDED.customer_district,customer_division=EXCLUDED.customer_division,
      customer_locality=EXCLUDED.customer_locality,customer_landmark=EXCLUDED.customer_landmark,payment_method=EXCLUDED.payment_method,
      trx_id=EXCLUDED.trx_id,payment_status=EXCLUDED.payment_status,status=EXCLUDED.status,notes=EXCLUDED.notes,
      created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,history=EXCLUDED.history`,
      [o.id,customerId,o.subtotal||0,o.discount||0,o.coupon||null,o.zone,o.deliveryCharge||0,o.total||0,c.name||'',c.mobile||'',
        c.address||'',c.area||'',c.district||'',c.division||'',c.locality||'',c.landmark||'',o.paymentMethod,o.trxId||null,
        o.paymentStatus,o.status,o.notes||'',msToDate(o.createdAt),msToDate(o.updatedAt),json(arr(o.history))]);
  }
  await deleteMissing(client,'orders','id',lastPersistedState ? ids(lastPersistedState.orders,'id') : null,db.orders.map(o=>o.id));
}

function orderItemsChanged(id, db) {
  if (!lastPersistedState) return true;
  const oldOrder=lastPersistedState.orders.find(o=>o.id===id), newOrder=db.orders.find(o=>o.id===id);
  return !oldOrder || !newOrder || !sameJson(arr(oldOrder.items),arr(newOrder.items));
}

async function syncOrderItems(client, db) {
  const productIds=new Set(db.products.map(p=>p.id));
  for (const o of db.orders) {
    if (!orderItemsChanged(o.id,db)) continue;
    // The existing db.* shape has no item IDs. Synchronize only this order's
    // child rows; never touch items belonging to another order.
    await client.query('DELETE FROM order_items WHERE order_id=$1',[o.id]);
    for (const it of arr(o.items)) {
      await client.query(`INSERT INTO order_items(order_id,product_id,slug,name,cover,price,qty,size,type)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [o.id,it.productId && productIds.has(it.productId) ? it.productId : null,it.slug||'',it.name||'',it.cover||'',
          it.price||0,it.qty||0,it.size||null,it.type||'poster']);
    }
  }
}

async function upsertReviews(client, db) {
  const productIds=new Set(db.products.map(p=>p.id));
  for (const r of db.reviews) {
    const productId=r.productId && productIds.has(r.productId) ? r.productId : null;
    await client.query(`INSERT INTO reviews(id,product_id,name,rating,text,approved,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET product_id=EXCLUDED.product_id,name=EXCLUDED.name,rating=EXCLUDED.rating,
      text=EXCLUDED.text,approved=EXCLUDED.approved,created_at=EXCLUDED.created_at`,
      [r.id,productId,r.name,r.rating,r.text,r.approved!==false,msToDate(r.createdAt)]);
  }
  await deleteMissing(client,'reviews','id',lastPersistedState ? ids(lastPersistedState.reviews,'id') : null,db.reviews.map(r=>r.id));
}

async function upsertCoupons(client, db) {
  const previousCoupons = new Map(
    lastPersistedState
      ? lastPersistedState.coupons.map(c => [c.code, c])
      : []
  );

  for (const c of db.coupons) {
    const previous = previousCoupons.get(c.code);

    if (
      previous &&
      JSON.stringify(previous) === JSON.stringify(c)
    ) {
      continue;
    }

    await client.query(
      `INSERT INTO coupons(code,type,value,min_order,active,usage,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(code) DO UPDATE SET
         type=EXCLUDED.type,
         value=EXCLUDED.value,
         min_order=EXCLUDED.min_order,
         active=EXCLUDED.active,
         usage=EXCLUDED.usage,
         created_at=EXCLUDED.created_at`,
      [
        c.code,
        c.type,
        c.value,
        c.minOrder || 0,
        c.active !== false,
        c.usage || 0,
        msToDate(c.createdAt)
      ]
    );
  }

  await deleteMissing(
    client,
    'coupons',
    'code',
    lastPersistedState
      ? new Set(lastPersistedState.coupons.map(c => c.code))
      : null,
    db.coupons.map(c => c.code)
  );
}

async function upsertCarts(client, db) {
  for (const c of db.carts) {
    await client.query(`INSERT INTO carts(key,items,value,name,mobile,recovered,created_at,updated_at)
      VALUES($1,$2::jsonb,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(key) DO UPDATE SET items=EXCLUDED.items,value=EXCLUDED.value,name=EXCLUDED.name,mobile=EXCLUDED.mobile,
      recovered=EXCLUDED.recovered,created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at`,
      [c.key,json(arr(c.items)),c.value||0,c.name||'',c.mobile||'',!!c.recovered,msToDate(c.createdAt),msToDate(c.updatedAt)]);
  }
  await deleteMissing(client,'carts','key',lastPersistedState ? new Set(lastPersistedState.carts.map(c=>c.key)) : null,db.carts.map(c=>c.key));
}

async function upsertDesigns(client, db) {
  for (const d of db.designs) {
    await client.query(`INSERT INTO designs(id,customer_id,name,mobile,contact,product_type,quantity,details,files,status,quote,admin_note,created_at,updated_at,history)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT(id) DO UPDATE SET customer_id=EXCLUDED.customer_id,name=EXCLUDED.name,mobile=EXCLUDED.mobile,
      contact=EXCLUDED.contact,product_type=EXCLUDED.product_type,quantity=EXCLUDED.quantity,details=EXCLUDED.details,
      files=EXCLUDED.files,status=EXCLUDED.status,quote=EXCLUDED.quote,admin_note=EXCLUDED.admin_note,
      created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,history=EXCLUDED.history`,
      [d.id,d.customerId,d.name,d.mobile,d.contact||'',d.productType,d.quantity||1,d.details||'',json(arr(d.files)),d.status,
        d.quote===undefined?null:d.quote,d.adminNote||'',msToDate(d.createdAt),msToDate(d.updatedAt),json(arr(d.history))]);
  }
  await deleteMissing(client,'designs','id',lastPersistedState ? ids(lastPersistedState.designs,'id') : null,db.designs.map(d=>d.id));
}

async function upsertContent(client, db) {
  const previousContent = lastPersistedState
    ? (lastPersistedState.content || {})
    : null;

  for (const [key, c] of Object.entries(db.content)) {
    const previous = previousContent ? previousContent[key] : null;

    if (
      previous &&
      previous.title === (c.title || '') &&
      previous.body === (c.body || '') &&
      previous.updatedAt === c.updatedAt
    ) {
      continue;
    }

    await client.query(
      `INSERT INTO content_pages(page_key,title,body,updated_at) VALUES($1,$2,$3,$4)
       ON CONFLICT(page_key) DO UPDATE SET
         title=EXCLUDED.title,
         body=EXCLUDED.body,
         updated_at=EXCLUDED.updated_at`,
      [
        key,
        c.title || '',
        c.body || '',
        msToDate(c.updatedAt)
      ]
    );
  }

  await deleteMissing(
    client,
    'content_pages',
    'page_key',
    lastPersistedState
      ? keys(lastPersistedState.content)
      : null,
    Object.keys(db.content)
  );
}

async function upsertHomepage(client, db) {
  const h = db.homepage || {};
  const previous = lastPersistedState
    ? (lastPersistedState.homepage || {})
    : null;

  const currentComparable = {
    hero: h.hero || {},
    featuredIds: arr(h.featuredIds),
    newIds: arr(h.newIds),
    bestsellerIds: arr(h.bestsellerIds),
    collectionCategoryIds: arr(h.collectionCategoryIds),
    perksTitle: h.perksTitle || '',
    showSections: h.showSections || {}
  };

  const previousComparable = previous
    ? {
        hero: previous.hero || {},
        featuredIds: arr(previous.featuredIds),
        newIds: arr(previous.newIds),
        bestsellerIds: arr(previous.bestsellerIds),
        collectionCategoryIds: arr(previous.collectionCategoryIds),
        perksTitle: previous.perksTitle || '',
        showSections: previous.showSections || {}
      }
    : null;

  if (
    previousComparable &&
    JSON.stringify(previousComparable) === JSON.stringify(currentComparable)
  ) {
    return;
  }

  await client.query(
    `INSERT INTO homepage_config(
      id,hero,featured_ids,new_ids,bestseller_ids,
      collection_category_ids,perks_title,show_sections
    )
    VALUES(
      1,$1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7::jsonb
    )
    ON CONFLICT(id) DO UPDATE SET
      hero=EXCLUDED.hero,
      featured_ids=EXCLUDED.featured_ids,
      new_ids=EXCLUDED.new_ids,
      bestseller_ids=EXCLUDED.bestseller_ids,
      collection_category_ids=EXCLUDED.collection_category_ids,
      perks_title=EXCLUDED.perks_title,
      show_sections=EXCLUDED.show_sections`,
    [
      json(currentComparable.hero),
      json(currentComparable.featuredIds),
      json(currentComparable.newIds),
      json(currentComparable.bestsellerIds),
      json(currentComparable.collectionCategoryIds),
      currentComparable.perksTitle,
      json(currentComparable.showSections)
    ]
  );
}
async function upsertSessions(client, db) {
  for (const [token,s] of Object.entries(db.sessions)) {
    await client.query(`INSERT INTO sessions(token,type,entity_id,created_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(token) DO UPDATE SET type=EXCLUDED.type,entity_id=EXCLUDED.entity_id,created_at=EXCLUDED.created_at`,
      [token,s.type,s.id,msToDate(s.createdAt)]);
  }
  await deleteMissing(client,'sessions','token',lastPersistedState ? new Set(Object.keys(lastPersistedState.sessions||{})) : null,Object.keys(db.sessions));
}

async function upsertRevoked(client, db) {
  const previousRevoked = lastPersistedState
    ? (lastPersistedState.revoked || {})
    : null;

  for (const [token, at] of Object.entries(db.revoked)) {
    if (
      previousRevoked &&
      Object.prototype.hasOwnProperty.call(previousRevoked, token) &&
      previousRevoked[token] === at
    ) {
      continue;
    }

    await client.query(
      `INSERT INTO revoked_tokens(token,revoked_at) VALUES($1,$2)
       ON CONFLICT(token) DO UPDATE SET revoked_at=EXCLUDED.revoked_at`,
      [token, msToDate(at)]
    );
  }

  await deleteMissing(
    client,
    'revoked_tokens',
    'token',
    lastPersistedState
      ? new Set(Object.keys(lastPersistedState.revoked || {}))
      : null,
    Object.keys(db.revoked)
  );
}
async function persistState(pool, input, options={}) {
  const totalStart = Date.now();

  const db=normalizeDb(input);
  const client=await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock($1)',[ADVISORY_LOCK_KEY]);

    if (options.requireEmpty && !(await databaseEmpty(client))) {
      await client.query('ROLLBACK');
      return { imported:false };
    }

    async function timed(label, fn) {
      const start = Date.now();
      await fn();
      console.log(
        `[postgres timing] ${label}: ${((Date.now()-start)/1000).toFixed(2)}s`
      );
    }

    await timed('meta', () => upsertMeta(client,db));
    await timed('settings', () => upsertSettings(client,db));
    await timed('categories', () => upsertCategories(client,db));
    await timed('products', () => upsertProducts(client,db));
    await timed('product categories', () => syncProductCategories(client,db));
    await timed('customers', () => upsertCustomers(client,db));
    await timed('orders', () => upsertOrders(client,db));
    await timed('order items', () => syncOrderItems(client,db));
    await timed('reviews', () => upsertReviews(client,db));
    await timed('coupons', () => upsertCoupons(client,db));
    await timed('carts', () => upsertCarts(client,db));
    await timed('designs', () => upsertDesigns(client,db));
    await timed('content', () => upsertContent(client,db));
    await timed('homepage', () => upsertHomepage(client,db));
    await timed('sessions', () => upsertSessions(client,db));
    await timed('revoked', () => upsertRevoked(client,db));

    const commitStart = Date.now();
    await client.query('COMMIT');
    console.log(
      `[postgres timing] COMMIT: ${((Date.now()-commitStart)/1000).toFixed(2)}s`
    );

    lastPersistedState=clone(db);

    console.log(
      `[postgres timing] TOTAL: ${((Date.now()-totalStart)/1000).toFixed(2)}s`
    );

    return { imported:true };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function importJsonIfEmpty(pool,jsonPath) {
  const db=normalizeDb(JSON.parse(fs.readFileSync(jsonPath,'utf8')));
  const meaningful=db.products.length || db.categories.length || db.orders.length || db.customers.length ||
    Object.keys(db.settings).length || db.designs.length || db.reviews.length || db.carts.length || db.coupons.length ||
    Object.keys(db.content).length || Object.keys(db.sessions).length || Object.keys(db.revoked).length;
  if (!meaningful) return { imported:false };

  const result=await persistState(pool,db,{requireEmpty:true});
  if (!result.imported) return { imported:false };
  return { imported:true, counts:{ products:db.products.length, categories:db.categories.length,
    orders:db.orders.length, customers:db.customers.length, designs:db.designs.length,
    reviews:db.reviews.length, carts:db.carts.length, coupons:db.coupons.length } };
}

async function initialize({jsonPath}) {
  const pool=createPool();
  if (!pool) {
    return { mode:'json', pool:null, db:normalizeDb(JSON.parse(fs.readFileSync(jsonPath,'utf8'))) };
  }
  if (!(await schemaExists(pool))) {
    await pool.end();
    throw new Error('DATABASE_URL is set, but the required HSS PostgreSQL schema is not present. ' +
      'Run the approved schema SQL in Supabase first; data/db.json has NOT been modified.');
  }

  const migration=await importJsonIfEmpty(pool,jsonPath);
  const db=await loadState(pool);
  lastPersistedState=clone(db);
  return { mode:'postgres', pool, db, migration };
}

module.exports={ initialize, persistState, loadState, schemaExists, normalizeDb };
