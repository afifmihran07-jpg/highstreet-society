"""HSS — full CUSTOMER end-to-end browser suite (desktop + mobile)."""
from playwright.sync_api import sync_playwright
import random, sys

B = "http://localhost:3000"
fails = []
errs = []

def chk(label, cond):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        fails.append(label)

SUPPRESS = {"on": False}

def attach(pg):
    pg.on("pageerror", lambda e: errs.append("JS: " + str(e)[:140]))
    pg.on("console", lambda m: errs.append("CONSOLE: " + m.text[:140])
          if m.type == "error" and "401" not in m.text and not SUPPRESS["on"] else None)

def no_overflow(pg, tag):
    a = pg.evaluate("document.documentElement.scrollWidth")
    b = pg.evaluate("document.documentElement.clientWidth")
    return a <= b + 1

with sync_playwright() as p:
    br = p.chromium.launch()

    for label, vp, mobile in [("MOBILE 390px", {'width': 390, 'height': 844}, True),
                              ("DESKTOP 1280px", {'width': 1280, 'height': 900}, False)]:
        print(f"\n===== {label} =====")
        c = br.new_context(viewport=vp, is_mobile=mobile, has_touch=mobile)
        pg = c.new_page(); attach(pg)

        # 1. homepage
        pg.goto(B + "/", wait_until="networkidle"); pg.wait_for_timeout(1200)
        chk("homepage loads with products", pg.locator(".card").count() > 0)
        chk("homepage no overflow", no_overflow(pg, "home"))
        chk("hero renders", pg.locator(".hero2").count() > 0)

        # 2. nav -> shop
        pg.goto(B + "/shop", wait_until="networkidle"); pg.wait_for_timeout(1200)
        n_all = pg.locator(".card").count()
        chk("shop lists products", n_all > 0)
        chk("shop no overflow", no_overflow(pg, "shop"))

        # 3. category filter
        pg.goto(B + "/shop?cat=coquette-pink", wait_until="networkidle"); pg.wait_for_timeout(1200)
        chk("category filter returns products", 0 < pg.locator(".card").count() <= n_all)

        # 4. search
        pg.goto(B + "/shop?q=cherry", wait_until="networkidle"); pg.wait_for_timeout(1200)
        chk("search works", pg.locator(".card").count() > 0)

        # 5. poster product page — 6 posters viewable one by one
        pg.goto(B + "/product/her-exe", wait_until="networkidle"); pg.wait_for_timeout(1400)
        thumbs = pg.locator("#gthumbs button").count()
        chk("poster set gallery has cover + 6 posters", thumbs == 7)
        srcs = set()
        for i in range(7):
            pg.evaluate("GNAV(1)"); pg.wait_for_timeout(180)
            srcs.add(pg.locator("#gimg").get_attribute("src"))
        chk("each poster shows a distinct image", len(srcs) >= 6)
        chk("A4 / 3mm spec shown", "3mm" in pg.locator(".pdp").inner_text())
        chk("product page no overflow", no_overflow(pg, "pdp"))

        # 6. add to cart
        pg.locator("button:has-text('Add to Cart')").first.click(); pg.wait_for_timeout(800)
        chk("add to cart works", pg.evaluate("JSON.parse(localStorage.getItem('hss_cart')||'[]').length") > 0)

        # 7. cart page: qty +/- and remove
        pg.goto(B + "/cart", wait_until="networkidle"); pg.wait_for_timeout(1400)
        chk("cart shows item", pg.locator(".citem").count() == 1)
        before = pg.locator("#items").inner_text()
        pg.locator(".miniqty button").nth(1).click(); pg.wait_for_timeout(1200)
        chk("quantity increase updates cart",
            pg.evaluate("JSON.parse(localStorage.getItem('hss_cart'))[0].qty") == 2)
        pg.locator(".miniqty button").nth(0).click(); pg.wait_for_timeout(1200)
        chk("quantity decrease updates cart",
            pg.evaluate("JSON.parse(localStorage.getItem('hss_cart'))[0].qty") == 1)
        chk("cart totals visible", "Subtotal" in pg.locator("#sum").inner_text())
        chk("cart no overflow", no_overflow(pg, "cart"))

        # 8. registration (unique mobile)
        mob = "018" + str(random.randint(10000000, 99999999))
        pg.goto(B + "/account", wait_until="networkidle"); pg.wait_for_timeout(1200)
        if pg.locator("text=Create an account").count():
            pg.locator("text=Create an account").first.click(); pg.wait_for_timeout(600)
        ins = pg.locator(".panel input")
        for i, val in enumerate(["QA Customer", mob, "secret123"]):
            if i < ins.count():
                ins.nth(i).fill(val)
        pg.locator("button:has-text('Create account')").first.click(); pg.wait_for_timeout(3000)
        logged = pg.evaluate("!!localStorage.getItem('hss_token')")
        chk("customer registration works", logged)
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(2000)
        chk("customer session persists after refresh",
            pg.evaluate("!!localStorage.getItem('hss_token')"))

        # 9. custom design (requires account)
        pg.goto(B + "/custom-design", wait_until="networkidle"); pg.wait_for_timeout(1600)
        has_form = pg.locator("#d_type").count() > 0
        chk("custom design form available when logged in", has_form)
        if has_form:
            pg.select_option("#d_type", index=1)
            pg.fill("#d_qty", "2")
            pg.fill("#d_contact", mob)
            pg.fill("#d_details", "QA automated design request for verification purposes.")
            pg.click("#d_send"); pg.wait_for_timeout(3000)
            chk("custom design submits", pg.locator(".dreq").count() > 0)

        # 10. checkout full flow
        pg.goto(B + "/checkout", wait_until="networkidle"); pg.wait_for_timeout(1800)
        chk("checkout no overflow", no_overflow(pg, "checkout"))
        pg.fill("#f_name", "QA Customer")
        pg.fill("#f_mobile", mob)
        pg.select_option("#f_div", "Dhaka"); pg.wait_for_timeout(500)
        chk("districts populate", pg.locator("#f_dist option").count() > 1)
        pg.select_option("#f_dist", "Dhaka"); pg.wait_for_timeout(500)
        chk("thanas populate", pg.locator("#f_area option").count() > 1)
        pg.fill("#f_areaq", "dhanmo"); pg.wait_for_timeout(700)
        zone = pg.locator("#zonebox").inner_text()
        chk("inside-Dhaka zone + charge detected", "Inside Dhaka" in zone and "70" in zone)
        pg.fill("#f_local", "Dhanmondi 27")
        pg.fill("#f_landmark", "beside Rapa Plaza")
        pg.fill("#f_addr", "House 12, Road 5, 3rd floor")

        # outside Dhaka switches charge
        pg.select_option("#f_div", "Chattogram"); pg.wait_for_timeout(500)
        pg.select_option("#f_dist", "Cox's Bazar"); pg.wait_for_timeout(500)
        pg.fill("#f_areaq", "tekn"); pg.wait_for_timeout(700)
        z2 = pg.locator("#zonebox").inner_text()
        chk("outside-Dhaka charge applies", "Outside Dhaka" in z2 and "130" in z2)
        # back to Dhaka
        pg.select_option("#f_div", "Dhaka"); pg.wait_for_timeout(500)
        pg.select_option("#f_dist", "Dhaka"); pg.wait_for_timeout(500)
        pg.fill("#f_areaq", "dhanmo"); pg.wait_for_timeout(700)
        pg.fill("#f_local", "Dhanmondi 27")
        pg.fill("#f_addr", "House 12, Road 5, 3rd floor")

        # bKash payment + TrxID
        pg.locator(".paym:has-text('bKash')").click(); pg.wait_for_timeout(700)
        chk("bKash instructions + number shown", pg.locator(".paybox").count() > 0)
        pg.fill("#f_trx", "QA9TRX" + str(random.randint(1000, 9999)))
        total_txt = pg.locator("#sum").inner_text()
        chk("order total includes delivery", "Total" in total_txt)
        pg.click("#place"); pg.wait_for_timeout(4000)
        chk("order placed -> success page", "/success" in pg.url)
        if "/success" in pg.url:
            pg.wait_for_timeout(1500)
            body = pg.locator("body").inner_text()
            chk("confirmation shows order id", "HSS-" in body)
            chk("success page no overflow", no_overflow(pg, "success"))
            chk("cart cleared after order",
                pg.evaluate("JSON.parse(localStorage.getItem('hss_cart')||'[]').length") == 0)

        # 11. order tracking
        pg.goto(B + "/track", wait_until="networkidle"); pg.wait_for_timeout(1200)
        chk("track page loads", pg.locator("#t_id").count() > 0)
        chk("track no overflow", no_overflow(pg, "track"))

        # 12. remaining routes
        for path in ["/about", "/contact", "/wishlist", "/policy/faq", "/policy/shipping"]:
            pg.goto(B + path, wait_until="networkidle"); pg.wait_for_timeout(700)
            ok = pg.locator("body").inner_text().strip() != "" and no_overflow(pg, path)
            if not ok:
                fails.append("route " + path)
        chk("static/policy routes render", True)

        # 13. 404 + back button
        SUPPRESS["on"] = True
        pg.goto(B + "/definitely-not-a-page", wait_until="networkidle"); pg.wait_for_timeout(800)
        chk("404 page renders (no blank)", pg.locator("body").inner_text().strip() != "")
        pg.go_back(); pg.wait_for_timeout(1200)
        chk("browser back works", pg.locator("body").inner_text().strip() != "")
        SUPPRESS["on"] = False
        c.close()

    br.close()

print("\nJS ERRORS:", errs[:5] if errs else "none")
if errs:
    fails.append("js-errors")
print("CUSTOMER RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURE(S): {fails}")
sys.exit(1 if fails else 0)
