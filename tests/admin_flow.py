"""HSS — full ADMIN end-to-end browser suite."""
from playwright.sync_api import sync_playwright
import sys

B = "http://localhost:3000"
fails = []

HOOK = """
 const root=document.getElementById('root');
 const d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
 window.__log=[];
 Object.defineProperty(root,'innerHTML',{set(v){
   const k=v.includes('anav')?'DASHBOARD':(v.includes('id="u"')?'LOGIN':(v.includes('Checking')?'LOADING':(v.includes('Cannot reach')?'ERROR':'other')));
   window.__log.push(k); d.set.call(this,v);},get(){return d.get.call(this)}});
"""

def chk(label, cond):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        fails.append(label)

def login(pg):
    pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(700)
    pg.fill("#u", "hssadmin"); pg.fill("#p", "admin123")
    pg.click("#lbtn"); pg.wait_for_timeout(3500)

with sync_playwright() as p:
    br = p.chromium.launch()

    # ---------- 1. login / stability ----------
    print("1. LOGIN + STABILITY")
    c = br.new_context(viewport={'width': 1280, 'height': 900})
    pg = c.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text[:120])
          if m.type == "error" and "401" not in m.text else None)
    pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(700)
    pg.evaluate(HOOK)
    pg.fill("#u", "hssadmin"); pg.fill("#p", "admin123"); pg.click("#lbtn")
    pg.wait_for_timeout(5000)
    chk("dashboard opens", pg.locator(".anav").count() > 0)
    chk("exactly ONE render (no blink)", len(pg.evaluate("window.__log")) == 1)
    chk("15 modules", pg.locator(".anav button").count() == 15)

    # hold for 10s — the reported failure happened ~1s in
    frames = []
    for _ in range(20):
        pg.wait_for_timeout(500)
        frames.append("D" if pg.locator(".anav").count() else ("L" if pg.locator("#u").count() else "."))
    chk("stays on dashboard for 10s (no bounce)", set(frames) == {"D"})

    # ---------- 2. every section ----------
    print("2. ALL ADMIN SECTIONS")
    tabs = ["dash", "analytics", "products", "cats", "orders", "inv", "reviews",
            "coupons", "customers", "carts", "designs", "home", "content", "pay", "settings"]
    broken = []
    for t in tabs:
        pg.evaluate(f"GOTAB('{t}')"); pg.wait_for_timeout(1200)
        if pg.locator(".anav").count() == 0 or pg.locator("#pane h1").count() == 0:
            broken.append(t)
        body = pg.locator("#pane").inner_text()
        if "Something went wrong" in body or "undefined" in body.lower():
            broken.append(t + "(error)")
    chk(f"all 15 sections render ({','.join(broken) if broken else 'clean'})", not broken)
    chk("still authenticated after touring sections", pg.locator(".anav").count() > 0)

    # ---------- 3. refresh ----------
    print("3. REFRESH")
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(3000)
    chk("refresh keeps admin logged in", pg.locator(".anav").count() > 0)
    pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(2500)
    chk("direct /admin nav keeps session", pg.locator(".anav").count() > 0)

    # ---------- 4. category CRUD ----------
    print("4. CATEGORY CREATE / EDIT / DELETE")
    res = pg.evaluate("""async () => {
      const t = HSS.memToken || localStorage.getItem('hss_admin_token');
      const H = {'Content-Type':'application/json','Authorization':'Bearer '+t};
      const mk = await (await fetch('/api/admin/categories',{method:'POST',headers:H,
        body:JSON.stringify({name:'QA Temp Cat',description:'temp'})})).json();
      const id = mk.category && mk.category.id;
      const ed = await (await fetch('/api/admin/categories/'+id,{method:'PUT',headers:H,
        body:JSON.stringify({name:'QA Temp Cat 2'})})).json();
      const del = await (await fetch('/api/admin/categories/'+id,{method:'DELETE',headers:H})).json();
      return {created:!!id, edited:!!ed.ok, deleted:!!del.ok};
    }""")
    chk("category create", res["created"])
    chk("category edit", res["edited"])
    chk("category delete", res["deleted"])

    # ---------- 5. product CRUD (poster + clothing) ----------
    print("5. PRODUCT CREATE / EDIT / DELETE")
    res = pg.evaluate("""async () => {
      const t = HSS.memToken || localStorage.getItem('hss_admin_token');
      const H = {'Content-Type':'application/json','Authorization':'Bearer '+t};
      const cov='/images/products/her-exe/cover.jpg';
      const six=[1,2,3,4,5,6].map(n=>`/images/products/her-exe/p${n}.jpg`);
      const poster = await (await fetch('/api/admin/products',{method:'POST',headers:H,
        body:JSON.stringify({type:'poster',name:'QA Poster Set',price:649,stock:5,
          cover:cov,posters:six,published:true})})).json();
      const cloth = await (await fetch('/api/admin/products',{method:'POST',headers:H,
        body:JSON.stringify({type:'clothing',name:'QA Tee',price:890,stock:0,cover:cov,posters:[cov],
          sizes:[{size:'S',stock:3},{size:'M',stock:4}],published:true})})).json();
      const combo = await (await fetch('/api/admin/products',{method:'POST',headers:H,
        body:JSON.stringify({type:'combo',name:'QA Combo',price:1500,stock:4,cover:cov,posters:[cov],
          bundleItems:['Shirt','Pant'],published:true})})).json();
      const pid = poster.product && poster.product.id;
      const edit = await (await fetch('/api/admin/products/'+pid,{method:'PUT',headers:H,
        body:JSON.stringify({type:'poster',name:'QA Poster Set EDITED',price:700,stock:9,
          cover:cov,posters:six,published:true})})).json();
      const out = {
        poster:!!pid, clothing:!!(cloth.product&&cloth.product.id),
        clothStock: cloth.product ? cloth.product.stock : -1,
        combo:!!(combo.product&&combo.product.id),
        edited: !!edit.ok && edit.product.price===700,
        ids:[pid, cloth.product&&cloth.product.id, combo.product&&combo.product.id].filter(Boolean)
      };
      return out;
    }""")
    chk("poster product created (6 images enforced)", res["poster"])
    chk("clothing product created with sizes", res["clothing"])
    chk("clothing stock auto-summed (3+4=7)", res["clothStock"] == 7)
    chk("combo product created", res["combo"])
    chk("product edit persists", res["edited"])
    qa_ids = res["ids"]

    # verify they reach the storefront
    st = pg.evaluate("""async () => {
      const r = await (await fetch('/api/products?limit=100')).json();
      const names = (r.items||r.products||[]).map(p=>p.name);
      return {qaPoster:names.includes('QA Poster Set EDITED'), qaTee:names.includes('QA Tee'), total:r.total};
    }""")
    chk("edited product visible on storefront", st["qaPoster"])
    chk("clothing visible on storefront", st["qaTee"])

    # ---------- 6. image upload association ----------
    print("6. IMAGE UPLOAD")
    up = pg.evaluate("""async () => {
      const t = HSS.memToken || localStorage.getItem('hss_admin_token');
      const cv=document.createElement('canvas'); cv.width=cv.height=40;
      const ctx=cv.getContext('2d'); ctx.fillStyle='#f0f'; ctx.fillRect(0,0,40,40);
      const blob = await new Promise(r=>cv.toBlob(r,'image/png'));
      const fd=new FormData(); fd.append('images', blob, 'qa.png');
      const r = await (await fetch('/api/admin/upload',{method:'POST',
        headers:{'Authorization':'Bearer '+t}, body:fd})).json();
      if(!r.urls || !r.urls[0]) return {ok:false};
      const head = await fetch(r.urls[0]);
      return {ok:true, url:r.urls[0], served:head.status===200};
    }""")
    chk("image uploads", up.get("ok"))
    chk("uploaded image is served back", up.get("served"))

    # ---------- 7. orders + status workflow ----------
    print("7. ORDERS")
    order = pg.evaluate("""async () => {
      const r = await (await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:'QA Buyer',mobile:'01711111111',division:'Dhaka',district:'Dhaka',
          area:'Dhanmondi',locality:'Dhanmondi 27',address:'House 1, Road 2',
          paymentMethod:'bkash',trxId:'QA123TRX',items:[{id:'p01',qty:1}]})})).json();
      return r.order ? {id:r.order.id, total:r.order.total} : {err:r.error};
    }""")
    chk("customer order placed", "id" in order)
    oid = order.get("id")
    pg.evaluate("GOTAB('orders')"); pg.wait_for_timeout(2000)
    body = pg.locator("#pane").inner_text()
    chk("order appears in admin", oid in body)
    chk("customer details shown", "QA Buyer" in body and "01711111111" in body)
    chk("full address shown", "Dhanmondi" in body)
    chk("payment TrxID shown", "QA123TRX" in body)
    upd = pg.evaluate("""async (oid) => {
      const t = HSS.memToken || localStorage.getItem('hss_admin_token');
      const H={'Content-Type':'application/json','Authorization':'Bearer '+t};
      const a = await (await fetch('/api/admin/orders/'+oid,{method:'PUT',headers:H,
        body:JSON.stringify({status:'confirmed',paymentStatus:'paid'})})).json();
      return {ok:!!a.ok, status:a.order&&a.order.status, pay:a.order&&a.order.paymentStatus};
    }""", oid)
    chk("admin can confirm order + verify payment", upd["status"] == "confirmed" and upd["pay"] == "paid")

    # ---------- 8. customers + designs ----------
    print("8. CUSTOMERS / CUSTOM DESIGNS")
    pg.evaluate("GOTAB('customers')"); pg.wait_for_timeout(1500)
    chk("customers section renders", pg.locator("#pane h1").count() > 0)
    pg.evaluate("GOTAB('designs')"); pg.wait_for_timeout(1500)
    chk("custom designs section renders", pg.locator("#pane h1").count() > 0)

    # ---------- 9. cleanup QA products ----------
    pg.evaluate("""async (ids) => {
      const t = HSS.memToken || localStorage.getItem('hss_admin_token');
      for (const id of ids) {
        await fetch('/api/admin/products/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+t}});
      }
    }""", qa_ids)
    left = pg.evaluate("""async()=>{const r=await (await fetch('/api/products?limit=100')).json();
      return (r.items||[]).filter(p=>p.name.startsWith('QA ')).length;}""")
    chk("product delete works (QA items removed)", left == 0)

    chk("no JS errors during admin flow", not errs)
    if errs:
        print("     errors:", errs[:3])

    # ---------- 10. logout / re-login ----------
    print("10. LOGOUT / RE-LOGIN")
    pg.evaluate("ALOGOUT()"); pg.wait_for_timeout(3500)
    chk("logout returns to login page", pg.locator("#u").count() > 0)
    pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(2500)
    chk("/admin blocked after logout", pg.locator("#u").count() > 0 and pg.locator(".anav").count() == 0)
    pg.fill("#u", "hssadmin"); pg.fill("#p", "admin123"); pg.click("#lbtn"); pg.wait_for_timeout(3500)
    chk("re-login works", pg.locator(".anav").count() > 0)
    c.close()

    # ---------- 11. wrong credentials ----------
    print("11. WRONG CREDENTIALS")
    c2 = br.new_context(); pg2 = c2.new_page()
    pg2.goto(B + "/admin", wait_until="networkidle"); pg2.wait_for_timeout(600)
    pg2.fill("#u", "hssadmin"); pg2.fill("#p", "wrongpass"); pg2.click("#lbtn"); pg2.wait_for_timeout(2300)
    msg = pg2.locator(".toast").first.inner_text().strip() if pg2.locator(".toast").count() else ""
    chk("exact 'Wrong username or password'", msg == "Wrong username or password")
    chk("no dashboard", pg2.locator(".anav").count() == 0)
    chk("no session cookie", not any(k['name'] == 'hss_admin_token' for k in c2.cookies()))
    c2.close()

    # ---------- 12. mobile admin ----------
    print("12. MOBILE ADMIN (390px)")
    c3 = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    pg3 = c3.new_page()
    login(pg3)
    chk("mobile login -> dashboard", pg3.locator(".anav").count() > 0)
    ovf = []
    for t in ["dash", "orders", "products", "analytics", "designs", "settings"]:
        pg3.evaluate(f"GOTAB('{t}')"); pg3.wait_for_timeout(1100)
        a = pg3.evaluate("document.documentElement.scrollWidth")
        b = pg3.evaluate("document.documentElement.clientWidth")
        if a > b + 1: ovf.append(t)
    chk(f"no horizontal overflow on mobile admin ({ovf})", not ovf)
    pg3.reload(wait_until="networkidle"); pg3.wait_for_timeout(3000)
    chk("mobile session survives refresh", pg3.locator(".anav").count() > 0)
    c3.close()
    br.close()

print("\nADMIN RESULT:", "ALL PASS" if not fails else f"{len(fails)} FAILURE(S): {fails}")
sys.exit(1 if fails else 0)
