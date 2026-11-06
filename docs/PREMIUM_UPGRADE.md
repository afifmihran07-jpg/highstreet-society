# Premium storefront upgrade (2026-11-06)

**Status:** this is local only; nothing has been committed or deployed. No production data or settings were changed.
**Backups:** `backups/2026-11-06-premium/` holds `public/`, `tests/` and `server.js` as they were before this work.

## Phase 1: Foundations
- **Pages no longer jump while loading (desktop).** Layout shift on shop pages fell from 0.74 to 0.001, product pages from 0.47 to 0.000, category pages from 0.47 to 0.002, and the cart from 0.22 to 0.017 (good is under 0.1).
  - The header height and an empty content area are now reserved before content loads.
  - The cart draws itself once, with all items fetched in parallel, instead of showing a placeholder that later jumps.
- **Logo:** the 201 KB `logo.png` was used everywhere at 34–120 px. It's replaced by `logo-240.webp` at 15 KB with the same appearance, and the browser-tab icon by `favicon-64.png` at 9 KB. `logo.png` is still used for social-share images.
- **Fonts:** Space Grotesk weight 500 was loaded but never used. It's now dropped from all 15 pages.
- **Wording, prices and discounts:** unchanged, at your request. The About page text, discount badges (−N%, SAVE N%), button labels and review wording keep their original text.

## Phase 2: The artwork leads
- **Shop cards:** each set's card now shows its six actual posters as a small 3 × 2 gallery wall, each poster uncropped. Before, it showed the branded cover. The tag and wishlist heart moved off the artwork, and a set without six poster images falls back to its cover.
- **Product gallery:** it opens on the whole set (tap any poster to see it on its own), then each poster, then the branded cover last. The lightbox still opens the original full-size files.

## Phase 3: Consistent design system
- **Buttons:** three kinds, applied site-wide. Primary is lime, for one main action; secondary has an outline; quiet is text or an icon.
  - On the product page, Add to Cart is the main action, Buy Now is secondary, and Wishlist is a quiet icon button. The original labels are kept.
- **Icons:** one line-icon set (`HSS.ico`) replaces the emoji in empty states, the contact page, the 404 page, track order, custom design and the promotion label.
- **Type:** card text and tags use calmer sizes and weights; badges are no longer heavy and uppercase.
- **Contact page:** the Instagram handle typo (@highstreetsoociety) is fixed. The handle is now read from the saved profile link.

## Phase 4: Shopping experience
- **"Complete the wall"** fills a full row of 8: same-category sets first, then the best sellers and newest. Before, Marvel pages showed a single suggestion.
- **Reviews:** with no reviews, there is one line (the original text) plus a "Write a review" button that unfolds the form.
- **Cart:** one estimated total, "Delivery from ৳70", plus a note giving both delivery prices. Before it listed two delivery lines and "৳910+".
- **Checkout:**
  - Delivery shows "Select your district" until the address is known, instead of silently assuming inside Dhaka.
  - On phones, a sticky summary bar appears at the top (items · total · View summary).
  - Items load in parallel.
- **Accessibility:**
  - Every form label is connected to its field, site-wide.
  - Shop search, sort and stock filters have accessible names.
  - The Account and Wishlist pages have a heading.
  - The secondary grey text now has 4.6:1 contrast against the background (was 3.8:1).

## Phase 5: "See it on your wall"
- **What it is:** a new "See it on your wall" view on poster-set product pages. It's a true-scale front view of a wall, built from CSS and the set's six real posters. Each poster is A4 (21 × 29.7 cm) with 5 cm gaps.
- **Controls:**
  - Layout: 3 × 2, a row of 6, or 2 × 3. The real overall size is stated, for example "about 73 × 64 cm".
  - Wall colour: warm white, greige, sage or charcoal.
  - Room view, with an optional 170 cm sofa for scale (posters hung 22 cm above it), or a close-up.
  - Tapping a poster on the wall opens it in the gallery.
- No generated imagery, no new libraries, and the artwork is never altered.

## Tests
- `tests/browser/premium.js` is new, with 27 checks covering:
  - layout shift on 5 pages, logo weight, and the artwork on cards
  - discount badges kept and moved off the artwork, button hierarchy, and the related-sets row
  - reviews, cart and checkout totals, and linked form labels
  - wall-view proportions, sizes, layouts, colours, the sofa, and the mobile fit
- `tests/browser/run.js` product checks were updated for the set-first gallery.
