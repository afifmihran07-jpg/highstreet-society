# HIGHSTREET SOCIETY — Official Store 🛒

Production-ready, **mobile-first** Bangladesh e-commerce website. Posters, clothing, combos and custom design requests — all managed from one admin panel, no code changes needed.

## 🔐 Admin Login

- **URL:** `/admin`
- **Username:** `hssadmin`
- **Password:** `admin123`

Credentials are stored **server-side only**, hashed with scrypt + per-account salt. They appear nowhere in frontend JavaScript. Change them in **Store Settings → Admin login & password** (changing the password logs out all admin sessions).

## 📱 Mobile-first (the priority)

Designed at 390px first, then scaled up — not the reverse.

- **Verified zero horizontal overflow at 320 / 360 / 390 / 414 / 768px** across all 13 storefront pages
- 46px+ touch targets, 16px inputs (no iOS zoom), sticky header, bottom tab bar, floating WhatsApp button
- Swipeable product gallery, mobile product cards, one-hand checkout
- **Admin panel is mobile-first too** — tables collapse into labelled cards on phones, forms and image upload work on mobile

## ⚡ Performance

- **83% smaller images** — all 140 posters served as WebP (295KB → 53KB) with automatic JPEG fallback
- gzip on every response; CSS 9KB gzipped, JS 5KB gzipped
- Location data (9KB) cached in localStorage; store settings cached per session
- `loading="lazy"` + `decoding="async"`, fixed image dimensions to prevent layout shift, 30-day static caching

## 🏠 Homepage

Follows the reference design: purple cosmic gradient, floating poster collage, **"WEAR THE CULTURE. LIVE _the space._"**, sparkles, ticker, then New Arrivals → Cult Favourites → Shop by Vibe → Featured → Why HSS → Follow the Society → footer. **Your original logo is used everywhere — never replaced.** Everything is editable in Admin → Homepage.

## 📍 Bangladesh address system

**Division → District → Thana/Upazila → Area/Locality → Detailed address → Landmark**

- **8 divisions · 64 districts · 596 thanas/upazilas** (full official coverage)
- Type-to-search on the thana field
- **Separate free-text Area/Locality field** with smart suggestions — Mohammadpur, Dhanmondi, Gulshan 1 & 2, Banani, Bashundhara R/A, Mirpur 10, Uttara Sectors, Badda, Motijheel, Farmgate, Tejgaon, Wari, Jatrabari, Lalbagh, Old Dhaka and more, plus equivalents for Chattogram, Khulna, Sylhet, Rajshahi, Rangpur, Barishal, Gazipur, Narayanganj, Mymensingh
- Optional Landmark + delivery notes
- Delivery charge auto-detects: Dhaka city thana → ৳70, elsewhere → ৳130 (both admin-editable). **Recalculated server-side** so it cannot be tampered with.

## 🛍️ Product types

| Type | Behaviour |
|---|---|
| **Poster set** | Exactly 6 posters enforced; gallery with prev/next, swipe, tap-to-zoom; A4 + 3mm board shown |
| **Clothing** | Per-size stock (S–XXL preset), size must be selected before add-to-cart, sold-out sizes disabled |
| **Combo/bundle** | Bundle contents listed on the product page; optional sizes |

Stock is tracked **per size**, decremented on order and **restored on cancellation**.

## 🎨 Custom Design

Customers log in → choose product type, quantity, contact → describe the idea → upload up to 5 images/PDF → track status. Admin reviews, sets a **price quote**, adds a note, and moves it through `submitted → reviewing → quoted → approved → in-production → completed`. Customers only ever see their own requests (verified).

## 🛠️ Admin panel — 15 modules

Dashboard · Analytics · Products · Categories · Orders · Inventory · Reviews · Coupons · Customers · Abandoned Carts · **Custom Designs** · Homepage · Content/CMS · Delivery & Payments · Store Settings

Orders show the **complete address**, per-item sizes, full price breakdown, TrxID, and one-tap Call/WhatsApp. Statuses: `pending → payment-pending → payment-verified → confirmed → processing → ready → shipped → delivered` (+ cancelled).

## 💳 Payment

COD, bKash and Nagad. Manual workflow: customer submits a TrxID → order is marked **payment-pending / pending-verification** → admin verifies before anything is treated as paid. A transaction ID alone never confirms payment.

## 🔗 Social buttons

Real links, not decoration — WhatsApp opens the app via `wa.me/8801879665602` with a pre-written message; Instagram and Facebook open your profiles. Editable in Store Settings.

## ▶️ Running

```bash
cd /home/user/hss
npm install
npm run seed     # demo reset only — NEVER on a live store with real orders
npm start        # PORT=3000 by default
```

Back up `data/db.json` + `public/uploads/` — that's your entire business.

## ✅ Tested (real browser, mobile viewport)

Full 29-step customer journey: browse → category → poster set → swipe all 6 → add to cart → clothing size selection → quantity change → cart → checkout → division/district/thana/area/landmark → bKash + TrxID → order placed → admin login → verify customer, items, address, payment → change status → **confirmed in customer history and tracking**.

Also verified: size-level oversell blocking, invalid size/district/thana rejection, stock restore on cancel, custom-design upload + quoting + per-customer isolation, all admin APIs returning 401 to both anonymous and customer tokens, friendly error messages with no stack traces, and zero JS console errors.

## ⚠️ Deploying to Vercel / serverless (IMPORTANT)

Admin sessions are **stateless, HMAC-signed tokens**, so any instance can verify
a login issued by another instance. Set one environment variable in your host:

```
SESSION_SECRET = <a long random string>
```

Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

If `SESSION_SECRET` is not set, the server falls back to `settings.sessionSecret`
in `data/db.json`. On a **read-only / ephemeral** filesystem (Vercel, Lambda) that
value can differ per instance and logins will not stick — so set the env var.

Also note `data/db.json` is written at runtime (orders, products, reviews).
Vercel's filesystem is read-only and resets on every deploy, so orders placed
there will not persist. For a real shop, run this on a host with a persistent
disk (VPS, Render, Railway, Fly.io) or move the data layer to a hosted database.
