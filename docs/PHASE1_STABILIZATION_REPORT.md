# Phase 1 — Error Audit & Stabilization Report

**Project:** Highstreet Society (`C:\Users\hp\Documents\highstreet-society`)
**Date:** 2026-11-05
**Status:** All safely fixable issues are fixed and verified locally. **Nothing has been committed, pushed or deployed.** Production still serves the old code until you approve a deploy (see §6).
**Production data:** untouched. The only contact with production was read-only page views and GET requests, used to reproduce bugs and export the public catalog.

---

## 1. Summary

| | |
|---|---|
| Issues found and fixed | **27** (4 critical, 5 high, 10 medium, 8 low) |
| Unit / integration tests (`npm test`) | **34 / 34 pass** |
| Browser tests (`npm run test:browser`, Edge 156) | **245 / 245 pass**: desktop 1280px, tablet 768px, mobile 390px |
| Dependency vulnerabilities (`npm audit`) | **0** |
| Catalog verified | **18/18 products, 7/7 categories, 126/126 image URLs** (all HTTP 200, `image/*`) |
| Homepage page weight (mobile) | **9,100 KB → 794 KB** (−91 %) |
| Console errors / failed requests / broken images | **0** (across every page and flow tested) |

---

## 2. CRITICAL: strange characters on the homepage's first paint

### Reproduction (production, fresh load)
I loaded `https://highstreet-society.onrender.com/` in Edge with JavaScript **disabled**, which shows exactly what visitors see before any script runs. The page showed a large **`â—Œ`** and **`Loadingâ€¦`**. The browser tab title read **`Highstreet Society â€” A4 Poster Sets…`**, and the WhatsApp/Facebook preview text (`og:title`, `og:description`) was garbled the same way.

Evidence (screenshots in `docs/phase1-evidence/`):
- `homepage-first-paint-BEFORE-production-mobile.png` / `…-desktop.png`: the garbled glyphs.
- `homepage-first-paint-AFTER-fixed-mobile.png` / `…-desktop.png`: a clean spinner and "Loading…".

The bytes production serves for the loader are `C3 A2 E2 80 94 C5 92` (`â—Œ`) instead of `E2 97 8C` (`◌`).

### Exactly which characters
| Intended | Shown | Where |
|---|---|---|
| `◌` (loader) | `â—Œ` | homepage `#content` placeholder (visible until JS renders) |
| `…` | `â€¦` | "Loading…" |
| `—` | `â€”` | `<title>`, `og:title` |
| `•` | `â€¢` | `og:description` |

The other 13 pages were checked the same way and were clean on production.

### Root cause
Commit `dad0ad4` ("Add Google Search Console verification") re-saved `public/index.html` through a Windows-1252 conversion. Each UTF-8 character was decoded as Windows-1252 and re-encoded as UTF-8, a classic "mojibake". The HTML was correctly declared as UTF-8 (`<meta charset>` + `Content-Type: text/html; charset=utf-8`), so the browser faithfully rendered the corrupted bytes. Commit `e28881b` did the same to `server.js`, applying the corruption twice there (see issue 2).

### Contributing causes found during the investigation (all fixed)
1. **The loader used a font character.** `◌` (U+25CC) exists in neither site font (Space Grotesk, Archivo Black), so the browser borrows it from a system font. On phones without such a font it renders as a box (`□`), which is another "strange symbol". It appeared in 7 places.
2. **The page chrome waited for the network.** `renderLayout()` drew the header, menu, footer and tab bar only *after* `/api/settings` answered. That happened on every page, even when the settings were already cached. Visitors saw a bare, header-less page that then "popped" into shape, and on a sleeping Render instance this takes several seconds.
3. **The announcement text swapped.** The homepage's announcement bar started with hard-coded old text ("Cash on Delivery available all over Bangladesh"), which JavaScript then replaced with the live text ("DROP 01 LIVE • …").

### Fix
- Restored the correct UTF-8 characters in `public/index.html` (7) and `server.js` (12). The repair reversed the double-decoding exactly; it was not done by hand.
- Replaced every `◌` loader with a **pure-CSS spinner** (`.spin`, which also respects reduced-motion settings) in `index.html`, `product.html`, `account.js`, `admin.js`, `cart.js`, `shop.js` and `track.js`.
- `renderLayout()` now **paints the chrome immediately** (from cached settings when available) and refreshes it when `/api/settings` answers. The page only waits on a first-ever visit with no cache. Checkout always waits for *fresh* settings, because payment numbers must be current.
- The announcement bar starts empty on every page and **keeps its height** (`.announce:empty::before`), so the live text appears without a text swap or layout shift.
- **Regression guard:** `tests/encoding.test.js` fails if any project file contains mojibake, a byte-order mark, or the font-dependent glyph, or if any HTML page lacks a UTF-8 declaration. It was checked with a deliberately corrupted file, which it caught. `.editorconfig` tells editors to save as UTF-8.

### Verification
- **First paint, JS disabled:** all 16 URLs × desktop + mobile → **36/36 pass** (no garbled characters, no glyph, spinner present, announcement starts empty).
- **Repeated fresh loads, JS on:** 5 loads per viewport, each in a brand-new browser profile with empty cache. An observer installed *before* any page code ran inspected every text node and title change during rendering. **Pass on desktop and mobile.**
  - *The detector was validated:* the same check run against production **fails** on 3/3 loads per viewport (it catches `Highstreet Society â€” …`) and **passes** locally.
  - An early run against production passed falsely, most likely because Render's "waking up" page was served instead of the shop. The check now also requires the real HSS homepage to be present, so that can't recur.
- **Flicker test** (settings API artificially delayed 2.5 s): the header paints immediately and the announcement bar height is unchanged (0 px shift). On a cached visit, the header, footer and live announcement appear before the API answers. **3/3 pass.**

> ⚠️ Visitors will keep seeing the garbled loader until the fix is deployed.

---

## 3. All issues found

Severity: **C** critical · **H** high · **M** medium · **L** low.

### Security

| # | Sev | Issue | Root cause | Fix | Files |
|---|---|---|---|---|---|
| 3 | **C** | **Any website could read and act on the admin API** from a logged-in admin's browser (orders, customer names, phones, addresses). | CORS middleware reflected *any* `Origin` (even `null`) with `Access-Control-Allow-Credentials: true`, and session cookies were `SameSite=None`. This was left over from an old sandboxed preview iframe. | CORS is now an allow-list (`CORS_ORIGINS`, empty by default; the site needs none). Cookies are `SameSite=Lax`. | `server.js` |
| 4 | **C** | **Account takeover via "Forgot password".** Typing anyone's mobile number returned a valid reset token. | `/api/auth/forgot` issued a signed reset token to the caller, with no SMS or any other verification. | `/forgot` never issues tokens. Reset now needs a **one-time code** that the admin generates (Admin → Customers → 🔑 Reset code) and sends on WhatsApp after the customer messages from their registered number. Codes are 8 characters, valid 30–60 min, single-use (bound to the current password hash) and rate-limited. The customer screen offers a "Request a code on WhatsApp" button. | `server.js`, `public/js/account.js`, `public/js/admin.js` |
| 5 | **H** | **Changing a password did not log out other sessions** (admin or customer), despite the README saying so. A stolen token stayed valid for 30 days. | Tokens are stateless HMAC tokens; "revocation" only cleared a legacy in-memory list. | Tokens now carry `pv`, a fingerprint of the current password hash. Changing the password invalidates every earlier token. | `server.js` |
| 6 | **H** | **Session tokens leaked into URLs** (`?__t=<token>` on every API call), and from there into server, hosting and proxy logs. | Workaround for an old preview proxy. | Tokens travel only in the `Authorization` header, the HttpOnly cookie, or a request body. The server no longer accepts them from the URL. | `public/js/store.js`, `public/js/admin.js`, `server.js` |
| 7 | **H** | **Stored-XSS risk via uploads.** A file named `x.html` sent as `image/png` was stored as `.html` and served from the shop's own domain. | The file extension was taken from the client-supplied filename. | The extension is derived from the validated MIME type (customer design uploads and admin uploads). `X-Content-Type-Options: nosniff` added. | `server.js` |
| 8 | **H** | **No rate limiting** on admin login, customer login, register, password reset, orders, reviews, order tracking, design requests or cart tracking (unlimited password guessing, spam orders). | Not implemented. | In-memory per-IP limits (e.g. admin login 10 per 15 min) → HTTP 429 with `Retry-After`. | `server.js` |
| 9 | M | Missing security headers (clickjacking of `/admin`, MIME sniffing). | Not implemented. | `X-Frame-Options: SAMEORIGIN`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `HSTS` on HTTPS. | `server.js` |

### Bugs and runtime errors

| # | Sev | Issue | Root cause | Fix | Files |
|---|---|---|---|---|---|
| 1 | **C** | Garbled homepage first paint | See §2 | See §2 | `public/index.html`, `public/css/app.css`, `public/js/store.js` + 6 loaders |
| 2 | **H** | Garbled text in customer and admin messages, e.g. coupon error "Minimum order ÃƒÂ Ã‚Â§Ã‚Â³…" instead of "৳…", and order-history arrows. | Commit `e28881b` corrupted `server.js` twice (12 occurrences). | Characters restored. Guarded by the encoding test. | `server.js` |
| 10 | M | Requests without a JSON body crashed with **500** (reviews, register, login, orders…). | Express 5 leaves `req.body` undefined; handlers read `req.body.x` directly. | `req.body` defaults to `{}`, so these return proper 400s. | `server.js` |
| 11 | M | **Overselling**: the same product on two cart lines passed the stock check per line (e.g. 8 + 8 with stock 12). | Stock was checked per line, not per product. | Lines are merged per product+size *before* the stock check. More than 20 of one set is refused with a clear message (not silently reduced). | `server.js` |
| 12 | M | Checkout and cart crashed with a `TypeError` if settings could not load. | `H.settings.delivery` was read without a guard. | A clear "temporarily unavailable / retry" message, and checkout waits for fresh settings. | `public/js/checkout.js`, `public/js/cart.js` |
| 13 | M | Session and revocation records **grew forever** (one row per login, renewal or logout). The whole DB sits in memory and is cloned on every save. Legacy sessions never expired. | No pruning. | Entries older than the 30-day token lifetime are pruned hourly (Postgres rows follow). | `server.js` |
| 14 | L | Custom-design list could show broken entities like `&am`. | Text was HTML-escaped *then* cut to 150 characters. | Cut first, then escape. | `public/js/custom-design.js` |
| 15 | L | Unbounded order name/address length; cart-tracking quantity not validated. | Missing caps. | Name ≤ 80, address ≤ 500, qty clamped 1–20. | `server.js` |
| 16 | L | `stamp.js` rewrote all 15 HTML files on every start on Windows *(fixed in the previous session; listed for completeness)*. | It hashed raw bytes; Git checks files out with CRLF on Windows. | Hash with normalised line endings. | `stamp.js` |

### Performance

| # | Sev | Issue | Root cause | Fix | Files |
|---|---|---|---|---|---|
| 17 | **C** | **Homepage ≈ 9.1 MB, shop ≈ 8.8 MB, product ≈ 4.5 MB on mobile.** Slow and costly on Bangladeshi mobile data. | Every card loaded the full 1587×2245 px cover (0.6–1.1 MB WebP) to display it ~300 px wide. | New **`/img`** endpoint: resizes with `sharp` (already a dependency) to fixed widths, caches on disk and in browsers (30 days), and serves responsive `srcset`. It only accepts this shop's Supabase bucket (no open proxy), runs at most 3 resizes at once (memory-safe on Render), and falls back to the original image on any error. Product zoom still uses full resolution. | `server.js`, `public/js/store.js`, `product.js`, `cart.js`, `checkout.js`, `success.js`, `account.js`, `track.js`, `home.js` |
| 18 | M | Page chrome blocked on the settings API (see §2) | See §2 | See §2 | `public/js/store.js` |

Measured on the local server, mobile, Edge:

| Page | Before | After | LCP before → after |
|---|---|---|---|
| `/` | 9,100 KB | **794 KB** | 1028 → 1048 ms |
| `/shop` | 8,823 KB | **705 KB** | 2164 → **860 ms** |
| `/product/og-marvel` | 4,465 KB | **593 KB** | 992 → 1012 ms |

Layout shift (CLS) is ≤ 0.006 on all three pages (good is < 0.1).

### SEO

| # | Sev | Issue | Root cause | Fix | Files |
|---|---|---|---|---|---|
| 19 | M | **Shared product links previewed as the generic banner** with "Poster Set — Highstreet Society" on WhatsApp and Facebook. | The title, description and image were set by JavaScript, which preview crawlers don't run. | The server fills in each product's title, description, `og:image` (its cover) and `og:description`. | `server.js` |
| 20 | M | `og:image` was relative (`/images/hero-banner.jpg`), so share previews ignored it. | Relative URL. | Made absolute using `SITE_URL`. | `server.js` |
| 21 | M | Unknown product URLs returned **200** ("soft 404"). | A static page was served for any slug. | Unknown or unpublished products now return **404** (the page still shows "not found"). | `server.js` |
| 22 | L | No canonical URLs. | Not implemented. | `<link rel="canonical">` + `og:url` on public pages. | `server.js` |
| 23 | L | Cart, checkout, account, success, wishlist, track and admin pages were indexable. | No robots meta. | `noindex` on private pages. | `server.js` |
| 24 | L | Contact, track and policy pages had no meta description. | Missing tags. | Added. | `public/contact.html`, `track.html`, `policy.html` |
| 25 | L | Sitemap URLs used whatever host the request came in on; duplicate unreachable `return` line. | Code. | Sitemap uses `SITE_URL`; dead line removed. | `server.js` |
| 26 | L | `public/robots.txt` started with a byte-order mark. | Encoding. | Removed (the `/robots.txt` route was already correct). | `public/robots.txt` |

### Prevention

| # | Sev | Issue | Fix | Files |
|---|---|---|---|---|
| 27 | M | Nothing stopped a future mis-encoded save from shipping. | `tests/encoding.test.js` + `.editorconfig` | new files |

### Checked and found fine
- `npm audit`: 0 vulnerabilities. Only minor updates available (express 5.3.0, pg 8.23.1, dotenv 18.0.9, supabase-js 2.119.0); I didn't update them, as they're not needed for stability.
- Every local `/images`, `/css`, `/js` reference in HTML, JS and CSS exists on disk. Every internal page link resolves.
- All 126 product image URLs return 200 `image/*`.
- No horizontal overflow at 1280, 768 or 390 px on home, shop and product pages.
- Order prices are computed on the server (the client cannot set prices). Delivery charges are recalculated on the server.
- No XSS found in the storefront or admin templates: user data is escaped (one escape-then-truncate bug fixed, issue 14).

---

## 4. Tests executed and actual results

All runs were against a throwaway local server on a temporary copy of the live catalog snapshot. Test orders, accounts and uploads never touch production or your working copy.

### `npm test` → **34 / 34 pass**
| File | Tests | Covers |
|---|---|---|
| `tests/export-live-catalog.test.js` | 13 | read-only catalog export (site + DB modes), secret exclusion, path guards |
| `tests/local-safety.test.js` | 7 | local server refuses production DB and storage; local uploads; production mode unchanged |
| `tests/security.test.js` *(new)* | 9 | CORS allow-list, cookie flags, security headers, no URL tokens, password change ends sessions, reset-code flow (no token from `/forgot`, single-use, old sessions end), empty body → 4xx, rate limit 429, duplicate-line oversell, upload extension |
| `tests/encoding.test.js` *(new)* | 5 | mojibake, BOM, UTF-8 declarations, font-dependent glyph |

### `npm run test:browser` → **245 / 245 pass** (Microsoft Edge 156, headless)
| Area | Checks |
|---|---|
| Image URLs (HEAD) + resized images (`/img`, cache, refusal of foreign sources and widths) | 2 + 7 |
| Homepage / Shop / Categories (7) / Navigation & cart / console errors × desktop, tablet, mobile | 108 |
| Product pages: all 18 on desktop, 3 on tablet and mobile (name, ৳420, cover + 6 posters, specs, image loads, gallery) | 33 |
| First paint with JS off: 16 URLs × 2 viewports | 36 |
| Repeated fresh loads (5 per viewport) | 2 |
| First-load flicker | 3 |
| Search | 2 |
| Checkout COD + bKash (cart, delivery charge, live bKash number, order, success page, admin view, tracking, cancel → stock restored) | 17 |
| Customer register, reset via admin code (wrong code rejected, single use, old password dead), wishlist, custom design with upload | 12 |
| Admin: login, product list, new-product defaults; all 15 modules + product editor render without errors | 5 + 16 |
| Server log (no uncaught exceptions or crashes) + console/network errors during flows | 2 |

### Not run
`tests/*.py`, the original Playwright-Python suites: Python is not installed on this machine. The Node browser suite covers the same journeys and more.

---

## 5. Remaining known issues (not fixed, with reasons)

1. **No Content-Security-Policy.** The pages use inline `<script>` blocks and many inline `onclick` handlers, so a meaningful CSP needs a front-end refactor. Other headers are in place.
2. **The rate limiter trusts `X-Forwarded-For`** (`app.set('trust proxy', true)`, unchanged). A determined attacker can rotate fake IPs; the release review confirmed this (12 wrong admin logins with spoofed IPs all returned 401, never 429). The reset-code limit is keyed on the mobile number and is *not* affected. Fixing this means setting the exact proxy hop count for Render, which must be confirmed on the live service first.
3. **Customer passwords may be 4 characters.** That's the existing business rule; I didn't change it.
4. **Customer sessions issued before the deploy** carry no password fingerprint, so they stay valid until they expire (≤ 30 days) even if that customer resets their password. All new sessions are bound.
5. **The resized-image cache lives in the server's temp folder.** On Render it's wiped on each deploy or restart, so the first view of each image afterwards takes about 1 s to regenerate. Supabase's own image transformation also works on your project, but it's billed per image and is your decision.
6. **Brief font swap (FOUT)** while Google Fonts load (`display=swap`). The text appears in a fallback font, then switches. That's normal and not garbling.
7. **Order tracking needs only order ID + mobile** (IDs are sequential). Now rate-limited; acceptable for a small shop.
8. **Old demo data** (`data/db.json`, `seed.js`, `public/images/products/*`) and the legacy clothing/combo code paths remain. They're harmless and kept for compatibility.

---

## 6. Needs your action

1. **Approve commit + deploy.** Nothing is committed. Production keeps the garbled homepage and all the security holes above until this ships.
2. **After deploying:** the admin will *most likely stay logged in*. Old admin tokens have no password fingerprint, but they are recorded in the `sessions` table, and that legacy record is still honoured (verified in the release review). If the dashboard does show the login screen, sign in again with the **same** username and password; nothing else is needed. Customers stay logged in.
3. **Tell staff about the new password-reset process:** customer messages on WhatsApp → check it's from the registered number → Admin → Customers → 🔑 **Reset code** → "Send on WhatsApp".
4. **Recommended on Render:** add `NODE_ENV=production` as a second production signal next to Render's own `RENDER=true`. If you add a custom domain, also set `SITE_URL`.
5. If production still uses the demo admin login, **change the admin password**.
6. Remove `SUPABASE_SECRET_KEY` from your local `.env`; nothing local needs it.
7. Optional: decide whether to use Supabase image transformations instead of the built-in `/img` (cost decision). No action is needed to keep `/img`.

### Post-deployment security task (open)

- **SEC-1: rate-limit IP spoofing.** `app.set('trust proxy', true)` takes the client IP from the left-most `X-Forwarded-For` entry, which the client controls. Login, register, order and tracking limits can therefore be bypassed by rotating fake IPs (confirmed in the release review). The reset-code limit (per mobile number) is unaffected.
  - **Fix:** inspect the headers Render actually forwards on the live service. Then set the exact trusted hop count (e.g. `app.set('trust proxy', 1)`), or key the limiter on Render's client-IP header. Add a regression test that a spoofed `X-Forwarded-For` still gets 429.
  - **Until then:** keep a strong admin password (12+ characters).

---

## 7. Backups and changed files

- **Backups:** `backups/2026-11-05-phase1/` (full copy of `public/`, `server.js`, `stamp.js`, `db-postgres.js`, `package*.json`, `README.md`, `.gitignore`, `scripts/`, `tests/`, `docs/` taken before this phase) and `backups/2026-11-05-pre-local-dev/` (previous session).
- **Modified:** `server.js`, `stamp.js`, `public/css/app.css`, `public/js/{store,admin,account,cart,checkout,custom-design,home,product,shop,success,track}.js`, `public/{index,product,contact,track,policy}.html`, `public/robots.txt`, `README.md`, `.gitignore`, `package.json`, `package-lock.json`, `docs/LOCAL_DEVELOPMENT.md`. The other 10 HTML files only got refreshed `?v=` cache-busting hashes from `stamp.js`, because their JS and CSS changed.
- **New:** `.editorconfig`, `tests/security.test.js`, `tests/encoding.test.js`, `tests/browser/flows.js`, `docs/PHASE1_STABILIZATION_REPORT.md`, `docs/phase1-evidence/*.png`. Also new from the previous session: `scripts/dev.js`, `scripts/export-live-catalog.js`, `tests/export-live-catalog.test.js`, `tests/local-safety.test.js`, `tests/browser/run.js`, `docs/LOCAL_DEVELOPMENT.md`.
