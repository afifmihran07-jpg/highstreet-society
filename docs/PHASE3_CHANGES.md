# Phase 3, increment 1: security fix + dynamic website

**Status:** done locally, **not deployed** (deploying needs your approval). No production data or database schema was changed.
**Tests:** `npm test` 42/42 · `npm run test:browser` 265/265 (Edge; desktop, tablet, mobile).
**Backups:** `backups/2026-11-05-phase3/`.

## SEC-1: login rate-limit IP spoofing (fixed)
- **What was wrong:** `trust proxy: true` took the visitor's IP from the left-most `X-Forwarded-For` entry. The visitor controls that entry, so faking a new IP on each request got around every rate limit.
- **What happens now:** production traffic is visitor → Cloudflare → Render load balancer → app, and every hop *appends* to that header. The app now trusts only:
  - the direct connection (Render's load balancer)
  - private/CGNAT addresses
  - Cloudflare's published edge ranges

  The client IP is the right-most address that isn't one of those, which is the address Cloudflare actually saw. Anything a visitor injects sits further left and is ignored.
- **Override:** set `TRUST_PROXY` (a hop count, `false`, or a CIDR list) if the hosting chain changes. `true` is refused.
- **Verify after deploy:** log in to admin, then open `/api/admin/client-ip`. The `ip` value must match your public IP (check it at whatismyip.com).
- **Tests:** rotating spoofed entries still gets 429; separate visitors behind the same proxies keep separate limits; IPv6; override behaviour.

## Website now reflects the poster-only business
- **Homepage copy is fully editable** in Admin → Homepage: the 3 headline lines, subtitle, tagline, bottom strip, hero image, marquee messages, section titles and subtitles, perks (up to 6) and the Instagram block. Previously the headline lines, marquee, perks and section text were hardcoded or not editable. The admin "Title" field didn't appear anywhere on the site, and the uploaded hero image was ignored.
- **Built-in wording is poster-focused.** It applies wherever a field is left empty. "Wear the culture" and "Quality • Comfort • Culture" are gone from the code.
- **One-click button:** "✨ Fill with recommended poster-shop copy". It fills the form for you to review, then you save.
- **Still yours to change (stored data, not code):** your *live* homepage still shows the old wording ("WEAR THE CULTURE", "Contemporary pieces for the streets…"), and the footer shows the brand tagline "Born on the streets. Quality • Comfort • Culture".
  - Change the homepage after deploying: Admin → Homepage → Fill with recommended copy → Save.
  - Change the tagline in Admin → Store Settings, which shows a suggestion.
  - The default hero collage image (`/images/hero-collage.*`) shows the old pink/"coquette" demo posters; uploading a hero image of your own live sets is recommended.

## Admin: manage without code
- **🔥 Promotions (new):**
  - **What a promotion is:** a scheduled sale with a name, a % or ৳ discount, all sets or selected categories, optional start/end times, and an optional banner that replaces the announcement bar while it runs.
  - **Scheduling:** promotions start and stop on their own, and can be paused without being deleted.
  - **Pricing:** the server applies the discount everywhere, including the order total. Customers always get the lowest of the regular, own-sale and promotion prices, and coupons still apply on top.
  - **Status:** shown as running, scheduled, paused or ended.
  - **Storage:** promotions live in the existing content table under a reserved key, so no database migration is needed. They are never exposed through the public content API.
- **Bulk product actions:** tick sets in Products, then use the bulk bar. Actions:
  - set regular price, set sale price, or sale by % off the regular price
  - remove sale, set stock
  - publish or hide
  - add to or remove from a category
  - turn badges (Featured / New / Bestseller) on or off

  Every action is checked for all selected sets first, so a bad value changes nothing.
- **Categories:** Edit now covers name, description (shown on that category's shop page) and a tile image for the homepage "Shop by vibe" row, with upload.

## Discovery, mobile shopping, checkout
- **Shop:**
  - Filters (category, sort, in-stock, search) are kept in the URL, so links are shareable and Back returns to the same view.
  - A category page shows its name and description.
  - The New/Best filter shows as a removable chip.
- **Product page:**
  - The category appears in the breadcrumb and in the "More …" link.
  - A promotion label shows with its end date.
  - Free-delivery threshold is shown in the delivery info.
  - Fixed a crash ("Set not found") when settings failed to load.
- **Mobile:** a sticky "Add to cart" bar with the price appears once the main buttons scroll away. It sits above the tab bar, and the WhatsApp button moves up to make room.
- **Cart:**
  - Items load in parallel (they used to load one at a time).
  - A "free delivery" progress bar shows how much more is needed.
  - The total respects the free-delivery threshold; previously it always added the delivery charge.

## Local development
`_promotions` is not part of the public catalog export, so local copies start with no promotions. Create test promotions in the local admin; they only touch `data/db.local.json`.

## Next increments (suggested)
- Checkout: clearer payment step on mobile (saved-address autofill already exists).
- "Buy 2+ sets" multi-buy discount (needs a decision on the rule).
- Search suggestions while typing; price-range filter.
