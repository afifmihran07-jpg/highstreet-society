"""HSS — REAL BUSINESS FLOW: customer <-> admin, full chain, all 6 scenarios.
Mobile 390px for customer, 1280px for admin.
"""
from playwright.sync_api import sync_playwright
import random, sys, time

B = "http://localhost:3000"
fails, notes = [], []
BAD = ["Could not refresh your session", "session ended", "Something went wrong", "Cannot reach"]

def chk(l, c, extra=""):
    print(("  PASS  " if c else "  FAIL  ") + l + (f"   [{extra}]" if extra and not c else ""))
    if not c: fails.append(l)

def rnd_mobile():
    return "01" + str(random.randint(3, 9)) + str(random.randint(10000000, 99999999))

def no_ovf(pg):
    return pg.evaluate("document.documentElement.scrollWidth") <= pg.evaluate("document.documentElement.clientWidth") + 1

# ---------- admin helper: runs inside the admin page context, uses the app's own auth ----------
def adm(pg, path, method="GET", body=None):
    return pg.evaluate("""async ([p,m,b]) => {
        try{ const r = await HSS.api(p, Object.assign({admin:true, method:m}, b?{body:b}:{}));
             return {ok:true, d:r}; }
        catch(e){ return {ok:false, err:(e.status||'')+' '+e.message}; }
    }""", [path, method, body])

with sync_playwright() as p:
    br = p.chromium.launch()

    # ============ ADMIN CONTEXT (desktop 1280) ============
    actx = br.new_context(viewport={'width': 1280, 'height': 900})
    apg = actx.new_page()
    aerr = []
    apg.on("pageerror", lambda e: aerr.append(str(e)[:120]))
    apg.goto(B + "/admin", wait_until="networkidle"); apg.wait_for_timeout(700)
    apg.fill("#u", "hssadmin"); apg.fill("#p", "admin123"); apg.click("#lbtn"); apg.wait_for_timeout(4000)
    chk("ADMIN login -> dashboard", apg.locator(".anav").count() > 0)

    # ============ CUSTOMER CONTEXT (mobile 390) ============
    cctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    cpg = cctx.new_page()
    cerr = []
    cpg.on("pageerror", lambda e: cerr.append(str(e)[:120]))

    # ---------------------------------------------------------------- SCENARIO 3 (first: create data)
    print("\n===== SCENARIO 3: admin creates poster category + 6-poster set =====")
    r = adm(apg, "/api/admin/categories", "POST", {"name": "QA Anime", "description": "QA anime posters"})
    chk("admin creates poster category 'QA Anime'", r["ok"], r.get("err"))
    cat_id = r["d"]["category"]["id"] if r["ok"] else None

    # upload cover + 6 posters as REAL files through the admin upload API
    up = apg.evaluate("""async () => {
        const mk = (label, hue) => new Promise(res => {
          const cv=document.createElement('canvas'); cv.width=600; cv.height=750;
          const x=cv.getContext('2d');
          x.fillStyle='hsl('+hue+',70%,45%)'; x.fillRect(0,0,600,750);
          x.fillStyle='#fff'; x.font='bold 64px sans-serif'; x.fillText(label, 40, 400);
          cv.toBlob(b=>res(b), 'image/png');
        });
        const fd = new FormData();
        fd.append('images', await mk('COVER', 300), 'cover.png');
        for(let i=1;i<=6;i++) fd.append('images', await mk('P'+i, i*50), 'p'+i+'.png');
        try{ const r = await HSS.api('/api/admin/upload',{admin:true, method:'POST', body:fd});
             return {ok:true, urls:r.urls}; }catch(e){ return {ok:false, err:e.message}; }
    }""")
    chk("admin uploads cover + 6 poster images", up["ok"] and len(up.get("urls", [])) == 7, up.get("err"))
    urls = up.get("urls", [])

    pset = None
    if urls and cat_id:
        r = adm(apg, "/api/admin/products", "POST", {
            "type": "poster", "name": "QA Anime Set 01",
            "description": "Six-poster anime wall set for QA verification.",
            "price": 749, "stock": 7, "cover": urls[0], "posters": urls[1:7],
            "categoryIds": [cat_id], "published": True})
        chk("admin creates 6-poster set assigned to QA Anime", r["ok"], r.get("err"))
        pset = r["d"]["product"] if r["ok"] else None

    # customer sees it in the right category
    if pset:
        cpg.goto(f"{B}/shop?cat={cat_id}", wait_until="networkidle"); cpg.wait_for_timeout(1500)
        chk("CUSTOMER sees new set under QA Anime category", "QA Anime Set 01" in cpg.locator("body").inner_text())
        chk("category chips render on mobile", cpg.locator("#catchips .chip").count() > 1)
        chk("shop no overflow @390", no_ovf(cpg))

        cpg.goto(f"{B}/product/{pset['slug']}", wait_until="networkidle"); cpg.wait_for_timeout(1600)
        thumbs = cpg.locator("#gthumbs button").count()
        chk("poster set shows cover + 6 posters (7 thumbs)", thumbs == 7, f"got {thumbs}")
        # verify every image actually loads (naturalWidth > 0)
        loaded = cpg.evaluate("""() => {
            const imgs=[...document.querySelectorAll('#gthumbs img')];
            return imgs.map(i=>i.naturalWidth>0);
        }""")
        chk("all 7 gallery images load (no broken)", all(loaded), str(loaded))
        # step through all 6 posters one by one
        srcs = set()
        for _ in range(7):
            cpg.evaluate("GNAV(1)"); cpg.wait_for_timeout(200)
            srcs.add(cpg.locator("#gimg").get_attribute("src"))
        chk("6 posters viewable one-by-one (distinct)", len(srcs) >= 6, f"{len(srcs)} distinct")
        chk("product page no overflow @390", no_ovf(cpg))

    # ---------------------------------------------------------------- SCENARIO 1: clothing + size + bKash
    print("\n===== SCENARIO 1: customer buys clothing w/ size, bKash =====")
    r = adm(apg, "/api/admin/products", "POST", {
        "type": "clothing", "name": "QA Hoodie", "description": "QA hoodie",
        "price": 1890, "stock": 0, "cover": urls[0] if urls else "/images/products/her-exe/cover.jpg",
        "posters": [urls[0]] if urls else ["/images/products/her-exe/cover.jpg"],
        "sizes": [{"size": "S", "stock": 2}, {"size": "M", "stock": 5}, {"size": "L", "stock": 0}],
        "categoryIds": ["clothing"], "published": True})
    chk("admin creates clothing with sizes", r["ok"], r.get("err"))
    hoodie = r["d"]["product"] if r["ok"] else None
    chk("clothing stock auto-sums (2+5+0=7)", hoodie and hoodie["stock"] == 7)

    mob1 = rnd_mobile()
    cpg.goto(B + "/account", wait_until="networkidle"); cpg.wait_for_timeout(1200)
    if cpg.locator("text=Create an account").count():
        cpg.locator("text=Create an account").first.click(); cpg.wait_for_timeout(600)
    ins = cpg.locator(".panel input")
    for i, v in enumerate(["QA Rahim", mob1, "secret123"]):
        if i < ins.count(): ins.nth(i).fill(v)
    cpg.locator("button:has-text('Create account')").first.click(); cpg.wait_for_timeout(3000)
    chk("CUSTOMER registration works", cpg.evaluate("!!HSS.store.get('hss_token')"))

    if hoodie:
        cpg.goto(f"{B}/product/{hoodie['slug']}", wait_until="networkidle"); cpg.wait_for_timeout(1500)
        chk("size selector shown", cpg.locator("#sizes .sz").count() == 3)
        chk("sold-out size L disabled", cpg.locator("#sizes .sz.out").count() == 1)
        cpg.locator("button:has-text('Add to Cart')").first.click(); cpg.wait_for_timeout(700)
        chk("blocked without size", cpg.evaluate("JSON.parse(HSS.store.get('hss_cart')||'[]').length") == 0)
        cpg.locator("#sizes .sz:not(.out)").nth(1).click(); cpg.wait_for_timeout(300)  # M
        cpg.evaluate("PQTY(1)"); cpg.wait_for_timeout(200)                             # qty 2
        cpg.locator("button:has-text('Add to Cart')").first.click(); cpg.wait_for_timeout(900)
        cart = cpg.evaluate("JSON.parse(HSS.store.get('hss_cart')||'[]')")
        chk("added with size M qty 2", len(cart) == 1 and cart[0].get("size") == "M" and cart[0]["qty"] == 2)

    cpg.goto(B + "/cart", wait_until="networkidle"); cpg.wait_for_timeout(1500)
    chk("cart shows size chip", cpg.locator(".szchip").count() >= 1)
    chk("cart no overflow @390", no_ovf(cpg))

    cpg.goto(B + "/checkout", wait_until="networkidle"); cpg.wait_for_timeout(1800)
    cpg.fill("#f_name", "QA Rahim"); cpg.fill("#f_mobile", mob1)
    cpg.select_option("#f_div", "Dhaka"); cpg.wait_for_timeout(450)
    cpg.select_option("#f_dist", "Dhaka"); cpg.wait_for_timeout(450)
    cpg.fill("#f_areaq", "mohammadp"); cpg.wait_for_timeout(700)
    zone = cpg.locator("#zonebox").inner_text()
    chk("INSIDE Dhaka charge ৳70", "Inside Dhaka" in zone and "70" in zone, zone.replace("\n", " "))
    cpg.fill("#f_local", "Shia Masjid"); cpg.fill("#f_landmark", "beside Mosque")
    cpg.fill("#f_addr", "House 21, Road 4, Block B")
    cpg.locator(".paym:has-text('bKash')").click(); cpg.wait_for_timeout(600)
    chk("bKash instructions + number shown", cpg.locator(".paybox").count() > 0)
    trx1 = "BK" + str(random.randint(100000, 999999))
    cpg.fill("#f_trx", trx1)
    sumtxt = cpg.locator("#sum").inner_text()
    cpg.click("#place"); cpg.wait_for_timeout(4500)
    chk("order placed -> success page", "/success" in cpg.url, cpg.url)
    oid1 = cpg.url.split("id=")[1].split("&")[0] if "id=" in cpg.url else None
    chk("confirmation shows order id", bool(oid1) and oid1 in cpg.locator("body").inner_text())

    # ADMIN verifies the order in full
    apg.evaluate("GOTAB('orders')"); apg.wait_for_timeout(2500)
    ob = apg.locator("#pane").inner_text()
    chk("ADMIN sees order id", oid1 and oid1 in ob)
    chk("ADMIN sees customer name", "QA Rahim" in ob)
    chk("ADMIN sees mobile", mob1 in ob)
    chk("ADMIN sees full address", "Shia Masjid" in ob and "Mohammadpur" in ob)
    chk("ADMIN sees product + size", "QA Hoodie" in ob and "M" in ob)
    chk("ADMIN sees TrxID", trx1 in ob)
    chk("ADMIN sees bKash method", "BKASH" in ob.upper())
    chk("ADMIN sees delivery charge", "Delivery" in ob and "70" in ob)
    chk("ADMIN sees product image thumbnails", apg.locator(".oitems img").count() > 0)
    chk("ADMIN shows order date/time", any(ch.isdigit() for ch in ob))

    o = adm(apg, "/api/admin/orders")["d"]["orders"][0]
    chk("subtotal+delivery=total is correct", o["subtotal"] - o["discount"] + o["deliveryCharge"] == o["total"],
        f"{o['subtotal']}+{o['deliveryCharge']}!={o['total']}")
    chk("payment status starts pending-verification", o["paymentStatus"] == "pending-verification")

    # admin verifies payment + accepts
    r = adm(apg, f"/api/admin/orders/{oid1}", "PUT", {"paymentStatus": "paid"})
    chk("ADMIN marks payment received", r["ok"] and r["d"]["order"]["paymentStatus"] == "paid")
    r = adm(apg, f"/api/admin/orders/{oid1}", "PUT", {"status": "confirmed"})
    chk("ADMIN accepts/confirms order", r["ok"] and r["d"]["order"]["status"] == "confirmed")

    # customer sees it
    cpg.goto(B + f"/track?id={oid1}&mobile={mob1}", wait_until="networkidle"); cpg.wait_for_timeout(2500)
    tb = cpg.locator("body").inner_text().lower()
    chk("CUSTOMER tracking shows confirmed", "confirmed" in tb)
    chk("CUSTOMER tracking shows paid", "paid" in tb)
    cpg.goto(B + "/account", wait_until="networkidle"); cpg.wait_for_timeout(2500)
    chk("CUSTOMER order history shows the order", oid1 in cpg.locator("body").inner_text())

    # stock decremented on the right size
    hp = adm(apg, f"/api/admin/products")["d"]["products"]
    h2 = [x for x in hp if x["name"] == "QA Hoodie"]
    if h2:
        sz = {s["size"]: s["stock"] for s in h2[0]["sizes"]}
        chk("size M stock decremented 5->3", sz.get("M") == 3, str(sz))
        chk("total stock recalculated", h2[0]["stock"] == 5, str(h2[0]["stock"]))

    # ---------------------------------------------------------------- SCENARIO 2: poster set + Nagad + delivered
    print("\n===== SCENARIO 2: customer buys poster set via Nagad -> delivered =====")
    if pset:
        cpg.goto(f"{B}/product/{pset['slug']}", wait_until="networkidle"); cpg.wait_for_timeout(1500)
        cpg.locator("button:has-text('Add to Cart')").first.click(); cpg.wait_for_timeout(900)
        cpg.goto(B + "/checkout", wait_until="networkidle"); cpg.wait_for_timeout(1800)
        cpg.fill("#f_name", "QA Rahim"); cpg.fill("#f_mobile", mob1)
        cpg.select_option("#f_div", "Chattogram"); cpg.wait_for_timeout(450)
        cpg.select_option("#f_dist", "Cox's Bazar"); cpg.wait_for_timeout(450)
        cpg.fill("#f_areaq", "tekn"); cpg.wait_for_timeout(700)
        z2 = cpg.locator("#zonebox").inner_text()
        chk("OUTSIDE Dhaka charge ৳130", "Outside Dhaka" in z2 and "130" in z2, z2.replace("\n", " "))
        cpg.fill("#f_local", "Teknaf Bazar"); cpg.fill("#f_addr", "Main Road, 2nd floor")
        cpg.locator(".paym:has-text('Nagad')").click(); cpg.wait_for_timeout(600)
        chk("Nagad instructions shown", cpg.locator(".paybox").count() > 0)
        trx2 = "NG" + str(random.randint(100000, 999999))
        cpg.fill("#f_trx", trx2)
        cpg.click("#place"); cpg.wait_for_timeout(4500)
        chk("poster order placed", "/success" in cpg.url)
        oid2 = cpg.url.split("id=")[1].split("&")[0] if "id=" in cpg.url else None

        apg.evaluate("GOTAB('orders')"); apg.wait_for_timeout(2500)
        ob2 = apg.locator("#pane").inner_text()
        chk("ADMIN sees Nagad poster order", oid2 and oid2 in ob2 and trx2 in ob2 and "NAGAD" in ob2.upper())
        chk("ADMIN sees outside-Dhaka 130", "130" in ob2)
        adm(apg, f"/api/admin/orders/{oid2}", "PUT", {"paymentStatus": "paid"})
        adm(apg, f"/api/admin/orders/{oid2}", "PUT", {"status": "confirmed"})
        adm(apg, f"/api/admin/orders/{oid2}", "PUT", {"status": "processing"})
        adm(apg, f"/api/admin/orders/{oid2}", "PUT", {"status": "shipped"})
        r = adm(apg, f"/api/admin/orders/{oid2}", "PUT", {"status": "delivered"})
        chk("ADMIN full lifecycle -> delivered", r["ok"] and r["d"]["order"]["status"] == "delivered")
        cpg.goto(B + f"/track?id={oid2}&mobile={mob1}", wait_until="networkidle"); cpg.wait_for_timeout(2500)
        chk("CUSTOMER sees delivered", "delivered" in cpg.locator("body").inner_text().lower())

        # poster stock decremented
        pp = [x for x in adm(apg, "/api/admin/products")["d"]["products"] if x["name"] == "QA Anime Set 01"]
        chk("poster set stock decremented 7->6", pp and pp[0]["stock"] == 6, str(pp[0]["stock"]) if pp else "?")

    # ---------------------------------------------------------------- SCENARIO 4: edit category/set/images
    print("\n===== SCENARIO 4: admin edits -> customer sees update =====")
    r = adm(apg, "/api/admin/categories", "POST", {"name": "QA Girls"})
    girls_id = r["d"]["category"]["id"] if r["ok"] else None
    chk("admin creates 2nd category QA Girls", bool(girls_id))

    if pset and girls_id:
        # move the set to QA Girls + rename + replace cover
        newcov = apg.evaluate("""async () => {
            const cv=document.createElement('canvas'); cv.width=600; cv.height=750;
            const x=cv.getContext('2d'); x.fillStyle='#e91e8c'; x.fillRect(0,0,600,750);
            x.fillStyle='#fff'; x.font='bold 60px sans-serif'; x.fillText('NEWCOVER',30,400);
            const b=await new Promise(z=>cv.toBlob(z,'image/png'));
            const fd=new FormData(); fd.append('images',b,'newcover.png');
            try{ const r=await HSS.api('/api/admin/upload',{admin:true,method:'POST',body:fd}); return r.urls[0]; }
            catch(e){ return null; }
        }""")
        chk("admin uploads replacement cover", bool(newcov))
        r = adm(apg, f"/api/admin/products/{pset['id']}", "PUT", {
            "type": "poster", "name": "QA Anime Set 01 UPDATED",
            "description": "Updated description for QA.", "price": 799, "stock": 6,
            "cover": newcov or pset["cover"], "posters": pset["posters"],
            "categoryIds": [girls_id], "published": True})
        chk("admin edits set (name/price/cover/category)", r["ok"], r.get("err"))
        upd = r["d"]["product"] if r["ok"] else None

        cpg.goto(f"{B}/shop?cat={girls_id}", wait_until="networkidle"); cpg.wait_for_timeout(1600)
        chk("CUSTOMER sees set under QA Girls", "UPDATED" in cpg.locator("body").inner_text())
        cpg.goto(f"{B}/shop?cat={cat_id}", wait_until="networkidle"); cpg.wait_for_timeout(1600)
        chk("set NO LONGER under QA Anime", "QA Anime Set 01" not in cpg.locator("body").inner_text())

        cpg.goto(f"{B}/product/{upd['slug']}", wait_until="networkidle"); cpg.wait_for_timeout(1600)
        body = cpg.locator("body").inner_text()
        chk("CUSTOMER sees new price 799", "799" in body)
        chk("CUSTOMER sees updated description", "Updated description" in body)
        ok_imgs = cpg.evaluate("[...document.querySelectorAll('#gthumbs img')].every(i=>i.naturalWidth>0)")
        chk("all images still load after edit", ok_imgs)
        chk("still exactly 7 thumbs after edit", cpg.locator("#gthumbs button").count() == 7)

        # refresh admin, reopen product -> images still associated
        apg.reload(wait_until="networkidle"); apg.wait_for_timeout(3000)
        pr = [x for x in adm(apg, "/api/admin/products")["d"]["products"] if x["id"] == pset["id"]]
        chk("after admin refresh: 6 posters still associated", pr and len(pr[0]["posters"]) == 6)
        chk("after admin refresh: cover persisted", pr and pr[0]["cover"] == (newcov or pset["cover"]))

    # ---------------------------------------------------------------- SCENARIO 6: reject/cancel
    print("\n===== SCENARIO 6: admin rejects order -> customer sees cancelled =====")
    cpg.goto(f"{B}/product/{hoodie['slug']}", wait_until="networkidle"); cpg.wait_for_timeout(1400)
    cpg.locator("#sizes .sz:not(.out)").first.click(); cpg.wait_for_timeout(250)
    cpg.locator("button:has-text('Add to Cart')").first.click(); cpg.wait_for_timeout(800)
    cpg.goto(B + "/checkout", wait_until="networkidle"); cpg.wait_for_timeout(1800)
    cpg.fill("#f_name", "QA Rahim"); cpg.fill("#f_mobile", mob1)
    cpg.select_option("#f_div", "Dhaka"); cpg.wait_for_timeout(400)
    cpg.select_option("#f_dist", "Dhaka"); cpg.wait_for_timeout(400)
    cpg.fill("#f_areaq", "dhanmo"); cpg.wait_for_timeout(650)
    cpg.fill("#f_local", "Dhanmondi 27"); cpg.fill("#f_addr", "House 9, Road 2")
    cpg.click("#place"); cpg.wait_for_timeout(4500)
    oid3 = cpg.url.split("id=")[1].split("&")[0] if "id=" in cpg.url else None
    chk("3rd order placed (COD)", bool(oid3))
    before = [x for x in adm(apg, "/api/admin/products")["d"]["products"] if x["name"] == "QA Hoodie"][0]["stock"]
    r = adm(apg, f"/api/admin/orders/{oid3}", "PUT", {"status": "cancelled"})
    chk("ADMIN cancels/rejects order", r["ok"] and r["d"]["order"]["status"] == "cancelled")
    after = [x for x in adm(apg, "/api/admin/products")["d"]["products"] if x["name"] == "QA Hoodie"][0]["stock"]
    chk("cancel restores stock", after == before + 1, f"{before}->{after}")
    cpg.goto(B + f"/track?id={oid3}&mobile={mob1}", wait_until="networkidle"); cpg.wait_for_timeout(2500)
    chk("CUSTOMER sees cancelled in tracking", "cancel" in cpg.locator("body").inner_text().lower())

    # ---------------------------------------------------------------- CUSTOMER DATA + CUSTOM DESIGN
    print("\n===== CUSTOMER DATA + CUSTOM DESIGN =====")
    cust = adm(apg, "/api/admin/customers")["d"]["customers"]
    me = [c for c in cust if c["mobile"] == mob1]
    chk("ADMIN sees registered customer", bool(me))
    chk("customer name correct", me and me[0]["name"] == "QA Rahim")
    chk("customer orders linked", me and me[0].get("orders", 0) >= 2, str(me[0].get("orders")) if me else "")

    d = cpg.evaluate("""async () => {
        const cv=document.createElement('canvas'); cv.width=400;cv.height=400;
        const x=cv.getContext('2d'); x.fillStyle='#2ecc71'; x.fillRect(0,0,400,400);
        const b=await new Promise(z=>cv.toBlob(z,'image/png'));
        const fd=new FormData();
        fd.append('productType','Custom poster set (6 posters)');
        fd.append('details','QA custom design request with uploaded artwork.');
        fd.append('quantity','2'); fd.append('contact','""" + mob1 + """');
        fd.append('files', b, 'design.png');
        try{ const r=await HSS.api('/api/designs',{method:'POST',body:fd}); return {ok:true,d:r.design}; }
        catch(e){ return {ok:false,err:e.message}; }
    }""")
    chk("CUSTOMER submits custom design w/ image", d["ok"], d.get("err"))
    if d["ok"]:
        apg.evaluate("GOTAB('designs')"); apg.wait_for_timeout(2200)
        db = apg.locator("#pane").inner_text()
        chk("ADMIN sees design submission", d["d"]["id"] in db and "QA custom design" in db)
        furl = d["d"]["files"][0] if d["d"]["files"] else None
        chk("design file uploaded", bool(furl))
        if furl:
            st = apg.evaluate("async u => (await fetch(u)).status", furl)
            chk("design file accessible after refresh", st == 200)
        r = adm(apg, f"/api/admin/designs/{d['d']['id']}", "PUT",
                {"status": "quoted", "quote": 3500, "adminNote": "QA quote"})
        chk("ADMIN can quote/manage design", r["ok"] and r["d"]["design"]["quote"] == 3500)
        mine = cpg.evaluate("async()=>{const r=await HSS.api('/api/designs/mine');return r.designs[0];}")
        chk("CUSTOMER sees quote on their request", mine and mine["quote"] == 3500)

    # ---------------------------------------------------------------- SCENARIO 5: delete set + category
    print("\n===== SCENARIO 5: admin deletes set & category -> clean customer side =====")
    if pset:
        r = adm(apg, f"/api/admin/products/{pset['id']}", "DELETE")
        chk("ADMIN deletes poster set", r["ok"])
        cpg.goto(B + "/shop", wait_until="networkidle"); cpg.wait_for_timeout(1800)
        chk("CUSTOMER no longer sees deleted set", "QA Anime Set 01" not in cpg.locator("body").inner_text())
        st = cpg.evaluate("async s => (await fetch('/api/products/'+s)).status", pset["slug"])
        chk("deleted product URL returns 404 (no broken page)", st == 404)
    if girls_id:
        r = adm(apg, f"/api/admin/categories/{girls_id}", "DELETE")
        chk("ADMIN deletes category", r["ok"])
    if cat_id:
        adm(apg, f"/api/admin/categories/{cat_id}", "DELETE")
    cpg.goto(B + "/shop", wait_until="networkidle"); cpg.wait_for_timeout(1800)
    chk("shop still renders after category deletion", cpg.locator(".card").count() > 0)
    # scroll everything into view so lazy-loaded images finish before checking
    for _ in range(8):
        cpg.mouse.wheel(0, 1100); cpg.wait_for_timeout(450)
    cpg.wait_for_timeout(1800)
    broken = cpg.evaluate("""() => [...document.querySelectorAll('.card img')]
        .filter(i => i.complete && i.naturalWidth === 0).length""")
    chk("no broken product images on shop", broken == 0, f"{broken} broken")
    chk("no orphaned category chip", "QA Girls" not in cpg.locator("#catchips").inner_text())

    # ---------------------------------------------------------------- ADMIN MOBILE QA
    print("\n===== ADMIN MOBILE QA @390 =====")
    mctx = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    mpg = mctx.new_page()
    mpg.goto(B + "/admin", wait_until="networkidle"); mpg.wait_for_timeout(700)
    mpg.fill("#u", "hssadmin"); mpg.fill("#p", "admin123"); mpg.click("#lbtn"); mpg.wait_for_timeout(4000)
    chk("admin mobile login", mpg.locator(".anav").count() > 0)
    ovf = []
    for t in ["dash","analytics","products","cats","orders","inv","reviews","coupons",
              "customers","carts","designs","home","content","pay","settings","pnew"]:
        mpg.evaluate(f"GOTAB('{t}')"); mpg.wait_for_timeout(900)
        if not no_ovf(mpg): ovf.append(t)
        if any(b in mpg.locator("body").inner_text() for b in BAD): fails.append("admin error @" + t)
    chk(f"no horizontal overflow in any admin section ({ovf})", not ovf)
    mpg.evaluate("GOTAB('pnew')"); mpg.wait_for_timeout(1200)
    chk("product form usable on mobile (type picker)", mpg.locator("#typepick .tp").count() == 3)
    chk("image upload UI present on mobile", mpg.locator("#coverbox").count() > 0)
    mctx.close()

    # ---------------------------------------------------------------- cleanup
    if hoodie: adm(apg, f"/api/admin/products/{hoodie['id']}", "DELETE")
    chk("no JS errors (admin)", not aerr, str(aerr[:2]))
    chk("no JS errors (customer)", not cerr, str(cerr[:2]))
    actx.close(); cctx.close(); br.close()

print("\n" + "=" * 60)
print("RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURE(S):")
for f in fails: print("   -", f)
sys.exit(1 if fails else 0)
