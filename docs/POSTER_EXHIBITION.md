# Poster Exhibition (homepage 3D gallery)

The section directly below the hero. It has one slide per product set and shows that set's own poster images (never mixed, never duplicated). Every poster has a short description, and every poster leads to its set's product page.

## Managing it: Admin → 🎨 Poster Exhibition
- **On/off:** the switch at the top shows or hides the whole exhibition.
- **Order:** drag rows, or use ↑ / ↓, then press **Save changes**. The first visible set opens by default. This order is separate from the shop's own product order.
- **Hide / Show:** removes a set from the exhibition only. The product, its stock, images and orders are untouched, and a restored set returns to its saved slot.
- **New sets:** any newly published set with poster images appears automatically at the end. **Unpublished** sets never show, but keep their position and texts.
- **Details:** opens each set's six posters. For each one you can edit its title and short description (8–20 words), or use **Restore default**. Each set can also have an optional exhibition label; the product name is never changed. Warnings mark missing images or missing descriptions.
- **Preview on homepage:** shows the last *saved* version.

The Homepage CMS also has a "3D poster gallery" switch under Visible sections. It hides the section as well; both switches must be on for the exhibition to show.

## How it works
- **Data source:** `GET /api/exhibition` builds the slides live from the catalogue: published products with poster images, in the saved order.
- **Where settings are stored:** in the existing content table under the reserved key `_exhibition`. No database schema change was needed, and the key is not reachable through the public content API.
- **Default descriptions:** `data/exhibition-defaults.json` holds 108 descriptions, one per poster in the catalogue, keyed by the exact image URL. Each was written after viewing that artwork, and states only what the poster itself shows.
  - An admin edit overrides the default without changing the file.
  - A new poster has no default, so the site shows a neutral line and Admin flags it as "missing description".
- **Code:**
  - Frontend: `public/js/gallery3d.js`, plus the `.g3d*` styles in `public/css/app.css`.
  - Admin screen: `vExhibit` in `public/js/admin.js`.
  - Server: the "poster exhibition" block in `server.js`.
- **Tests:** `tests/exhibition.test.js` (server) and `tests/browser/gallery3d.js` (desktop, tablet, 390 px and 320 px phones, reduced motion, Admin).
