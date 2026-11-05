# HSS — Local development

How to run Highstreet Society on your own machine with the **real live catalog**, without any risk to production.

## TL;DR

```powershell
npm install
npm run export:catalog   # read-only copy of the live catalog -> data/db.live.json
npm run dev              # http://localhost:3000
```

Local admin: <http://localhost:3000/admin>, login `hssadmin` / `admin123` (local demo login, not production's).

## How the pieces fit

```
 production site (Render)                  your machine
 ────────────────────────                  ─────────────────────────────────────────────
 https://highstreet-society.onrender.com
   GET /api/products, /api/categories, ... ──► npm run export:catalog
   (public, read-only)                            └─► data/db.live.json   pristine snapshot (gitignored)
                                                         │  npm run dev / dev:reset
                                                         ▼
                                                  data/db.local.json      your working copy (gitignored)
                                                         │
                                                  npm run dev ──► server.js (JSON mode, uploads: local)
                                                                   http://localhost:3000
 Supabase Storage (product images) ◄── browser loads image URLs read-only
```

| File | What it is | Written by |
|---|---|---|
| `data/db.live.json` | Snapshot of the live public catalog | `npm run export:catalog` only |
| `data/db.local.json` | Your local working copy — admin edits, test orders, view counts land here | the local server |
| `data/db.json` | Committed demo data (old demo catalog). JSON-mode default and first-import seed for an empty Postgres | nothing in the dev workflow (`npm run seed` rewrites it) |
| `public/uploads/` | Images you upload in the local admin | the local server |
| `backups/` | Backups of files changed during maintenance + old `db.local.json` copies | `npm run dev:reset`, manual |

`data/db.live.json`, `data/db.local.json`, `public/uploads/*` and `backups/` are gitignored.

## Commands

| Command | What it does |
|---|---|
| `npm run export:catalog` | Refresh `data/db.live.json` from the live site. No credentials. Never touches `db.json` / `db.local.json`. |
| `npm run dev` | Start on port 3000 (`$env:PORT=3001; npm run dev` for another port). Creates `db.local.json` from the snapshot on first run. Refuses to start if the port is already taken. |
| `npm run dev:reset` | Back up `db.local.json` into `backups/db-local/` and recreate it from the snapshot (to pick up a fresh export or discard local edits). |
| `npm test` | Unit + integration tests: export script, local-safety guards, security regressions (CORS, cookies, tokens, password reset, rate limits, uploads, orders) and the encoding guard. ~15 s. |
| `npm run test:browser` | Real-browser tests in your installed Edge/Chrome at desktop 1280px, tablet 768px and mobile 390px: storefront, all products/categories/images, first paint (JS off) and repeated fresh loads, search, COD + bKash checkout, tracking, accounts + password reset, wishlist, custom design, all admin modules, server-log crash check. Starts its own server on port 3930 using a temp copy of the snapshot. Screenshots in `tests/browser/artifacts/`. Set `BASE_URL=http://localhost:3000` to test an already-running server. |
| `npm run stamp` | Refresh `?v=` cache-busting hashes in `public/*.html` (also run automatically by `dev`/`serve`/`start`). |

Typical refresh after products change in production:

```powershell
npm run export:catalog
npm run dev:reset
npm run dev
```

## Safety guarantees (and how they're enforced)

**Production data is read-only from this machine.**
- `export:catalog` (default `--source site`) only sends GET requests to the public storefront endpoints `/api/settings`, `/api/categories`, `/api/products`, `/api/homepage`, `/api/content/<key>`. These only read; a whitelist in the script refuses any other path (including the `POST …/view` counter).
- The local server never connects to production Postgres: `npm run dev` removes `DATABASE_URL` from its environment, and `server.js` itself **refuses to start** outside production if `DATABASE_URL` points at a remote host (a `localhost` Postgres is fine). Override only with `HSS_ALLOW_REMOTE_WRITES=1` — don't.

**Local uploads never reach production storage.**
- Upload destination is `UPLOAD_STORAGE`: `supabase` by default only in production (`RENDER=true` or `NODE_ENV=production`), `local` everywhere else (files go to `public/uploads/`). `server.js` refuses to start with `UPLOAD_STORAGE=supabase` outside production unless `HSS_ALLOW_REMOTE_WRITES=1`.
- The Supabase client is created lazily, only when a production upload actually happens, so local runs don't need `SUPABASE_SECRET_KEY` at all. **Recommendation:** remove `SUPABASE_SECRET_KEY` from your local `.env`; nothing local needs it any more.

**No private data or secrets in the snapshot.** The export contains only published products, visible categories, homepage config, policy pages and public store settings (the same fields `/api/settings` shows visitors). Customers, orders, reviews, coupons, carts, design requests, sessions, admin password hash and session secret are never read; the script validates this before writing.

**Startup line tells you where things go:**

```
[hss] Environment: development | uploads: local | data: data\db.local.json
```

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` | server | Port (default 3000) |
| `HSS_DATA_FILE` | server | JSON data file in JSON mode (default `data/db.json`; `npm run dev` sets `data/db.local.json`) |
| `UPLOAD_STORAGE` | server | `local` or `supabase` (default: `supabase` in production, `local` elsewhere) |
| `HSS_ALLOW_REMOTE_WRITES` | server | `1` disables the local-safety refusals. Avoid. |
| `DATABASE_URL` | server (production) | Supabase Postgres. Never set locally. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | server (production) | Product-image uploads to Supabase Storage |
| `SESSION_SECRET` | server (production) | HMAC key for admin/customer tokens |
| `RENDER` | server | Set automatically by Render; marks production |
| `SITE_URL` | server | Public base URL used for canonical links, `og:url`, absolute `og:image` and the sitemap (default `https://highstreet-society.onrender.com`). Set it if you move to a custom domain. |
| `CORS_ORIGINS` | server | Comma-separated extra origins allowed to call the API with credentials. Empty by default (the site itself needs none). |
| `HSS_IMG_CACHE_DIR` | server | Disk cache for resized product images served by `/img` (default: OS temp dir) |
| `HSS_EXPORT_BASE_URL` | export | Live site URL for `--source site` (default the Render URL) |
| `HSS_EXPORT_DATABASE_URL` | export | Only for `--source db` (below) |

## Optional: exporting unpublished drafts (`--source db`)

The default export sees what visitors see: **published** products and **visible** categories. If you also need drafts/hidden categories, the script can read Postgres directly inside a single `READ ONLY` transaction that is always rolled back. This needs a database credential, so:

1. In the Supabase SQL editor, create a dedicated read-only role. The exact SQL is in the header comment of `scripts/export-live-catalog.js`; it grants `SELECT` on the catalog tables only and column-level `SELECT` on `app_settings` (so the admin hash and session secret are unreadable even to this role).
2. Run, in a terminal session only (don't put it in `.env`, never name it `DATABASE_URL`):
   ```powershell
   $env:HSS_EXPORT_DATABASE_URL = 'postgresql://hss_catalog_reader.<project-ref>:<password>@<pooler-host>:5432/postgres'
   node scripts/export-live-catalog.js --source db --require-readonly-role --dry-run
   node scripts/export-live-catalog.js --source db --require-readonly-role
   Remove-Item Env:HSS_EXPORT_DATABASE_URL
   ```

## Troubleshooting

- **Local site shows old demo products (Coquette, Tokyo Neon, ৳649…)** — an old server started with plain `node server.js` is still running against `data/db.json`. On Windows a second server can appear to start on the same port while your browser keeps talking to the old one. `npm run dev` now detects this and stops with instructions. To find and stop the old one:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | % { Stop-Process -Id $_.OwningProcess }`
- **`[fatal] DATABASE_URL points at a remote database…`** — your `.env` contains `DATABASE_URL`. Remove it locally.
- **`git status` shows all HTML files modified after starting** — fixed: `stamp.js` now hashes with normalised line endings, so Windows (CRLF) and Linux produce the same `?v=` values.
- **Images missing locally** — product images are Supabase public URLs and need internet access. `npm run test:browser` checks every one.
- **`npm start` on Windows** — `run.sh` is the Linux production supervisor (uses `ss`, `kill`). Use `npm run dev` locally.

## Known gaps / notes

- Prices on the About page (`৳420 per set`) are static text in `public/about.html`; product prices themselves always come from the data.
- The live homepage's "Shop by vibe" collections section currently has no categories selected (Admin → Homepage). The local copy mirrors that.
- `seed.js` / `data/db.json` still contain the old demo catalog (with its demo images under `public/images/products/`). They're kept because `data/db.json` is the fallback/import seed; the dev workflow doesn't use them.
- `tests/*.py` are the original Playwright-Python end-to-end suites (need Python + `pip install playwright`). The Node suites above cover the storefront without Python.
