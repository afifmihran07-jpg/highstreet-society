"""HSS — admin session hardening + full admin CRUD cycle, mobile & desktop."""
from playwright.sync_api import sync_playwright
import sys, random

B = "http://localhost:3000"
fails = []

def chk(label, cond):
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        fails.append(label)

def ended(pg):
    return "session ended" in pg.locator("body").inner_text()

def login(pg):
    pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(700)
    pg.fill("#u", "hssadmin"); pg.fill("#p", "admin123")
    pg.click("#lbtn"); pg.wait_for_timeout(4000)

SECTIONS = ["dash","analytics","products","cats","orders","inv","reviews","coupons",
            "customers","carts","designs","home","content","pay","settings"]

with sync_playwright() as p:
    br = p.chromium.launch()
    for label, vp, mob in [("MOBILE 390px", {'width':390,'height':844}, True),
                           ("DESKTOP 1280px", {'width':1280,'height':900}, False)]:
        print(f"\n===== {label} =====")
        c = br.new_context(viewport=vp, is_mobile=mob, has_touch=mob)
        pg = c.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:110]))

        # ---- login
        login(pg)
        chk("login -> dashboard", pg.locator(".anav").count() > 0)
        chk("no 'session ended' at login", not ended(pg))

        # ---- 60s idle soak
        bad = 0
        for _ in range(60):
            pg.wait_for_timeout(1000)
            if pg.locator(".anav").count() == 0 or ended(pg):
                bad += 1
        chk("60s idle: stayed on dashboard", bad == 0)

        # ---- refresh
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(3000)
        chk("refresh keeps session", pg.locator(".anav").count() > 0 and not ended(pg))

        # ---- direct /admin
        pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(2800)
        chk("direct /admin keeps session", pg.locator(".anav").count() > 0 and not ended(pg))

        # ---- every section
        broken = []
        for t in SECTIONS:
            pg.evaluate(f"GOTAB('{t}')"); pg.wait_for_timeout(900)
            if pg.locator(".anav").count() == 0 or pg.locator("#pane h1").count() == 0 or ended(pg):
                broken.append(t)
        chk(f"all 15 sections ({broken or 'clean'})", not broken)

        # ---- HOSTILE: revoke the access token mid-session, then keep using the panel
        tok = pg.evaluate("HSS.memToken || localStorage.getItem('hss_admin_token')")
        pg.evaluate("""async () => {
          // poison the current access token via a direct DB-independent route:
          // call logout on a CLONE of the session is not possible, so emulate by
          // dropping the client token and letting heal() restore from refresh.
          HSS.memToken = 'eyJ0IjoiYWRtaW4iLCJpZCI6ImFkbWluIiwiaWF0IjoxfQ.bad';
          HSS.store.set('hss_admin_token', HSS.memToken);
        }""")
        pg.evaluate("GOTAB('orders')"); pg.wait_for_timeout(4000)
        chk("survives a broken access token (silent heal)", pg.locator(".anav").count() > 0)
        chk("no 'session ended' after heal", not ended(pg))

        # ---- customer logout in another tab must not affect admin
        pg2 = c.new_page()
        mno = "019" + str(random.randint(10000000, 99999999))
        pg2.goto(B + "/account", wait_until="networkidle"); pg2.wait_for_timeout(1200)
        if pg2.locator("text=Create an account").count():
            pg2.locator("text=Create an account").first.click(); pg2.wait_for_timeout(600)
        ins = pg2.locator(".panel input")
        for i, v in enumerate(["Iso Cust", mno, "secret123"]):
            if i < ins.count(): ins.nth(i).fill(v)
        pg2.locator("button:has-text('Create account')").first.click(); pg2.wait_for_timeout(2500)
        pg2.evaluate("HSS.logout && HSS.logout()"); pg2.wait_for_timeout(2500)
        pg2.close(); pg.bring_to_front()
        pg.evaluate("GOTAB('dash')"); pg.wait_for_timeout(2500)
        chk("admin survives customer logout", pg.locator(".anav").count() > 0 and not ended(pg))

        # ---- CRUD: category
        r = pg.evaluate("""async () => {
          const t = HSS.memToken || localStorage.getItem('hss_admin_token');
          const H = {'Content-Type':'application/json','Authorization':'Bearer '+t};
          const mk = await (await fetch('/api/admin/categories',{method:'POST',headers:H,
            body:JSON.stringify({name:'ZZ Temp Cat'})})).json();
          const id = mk.category && mk.category.id;
          const ed = await (await fetch('/api/admin/categories/'+id,{method:'PUT',headers:H,
            body:JSON.stringify({name:'ZZ Temp Cat 2'})})).json();
          const dl = await (await fetch('/api/admin/categories/'+id,{method:'DELETE',headers:H})).json();
          return {c:!!id, e:!!ed.ok, d:!!dl.ok};
        }""")
        chk("category create/edit/delete", r["c"] and r["e"] and r["d"])

        # ---- CRUD: products (poster / clothing / combo) + image upload
        r = pg.evaluate("""async () => {
          const t = HSS.memToken || localStorage.getItem('hss_admin_token');
          const H = {'Content-Type':'application/json','Authorization':'Bearer '+t};
          const cov='/images/products/her-exe/cover.jpg';
          const six=[1,2,3,4,5,6].map(n=>`/images/products/her-exe/p${n}.jpg`);
          const po = await (await fetch('/api/admin/products',{method:'POST',headers:H,
            body:JSON.stringify({type:'poster',name:'ZZ Poster',price:649,stock:5,cover:cov,posters:six,published:true})})).json();
          const cl = await (await fetch('/api/admin/products',{method:'POST',headers:H,
            body:JSON.stringify({type:'clothing',name:'ZZ Tee',price:890,stock:0,cover:cov,posters:[cov],
              sizes:[{size:'S',stock:3},{size:'M',stock:4}],published:true})})).json();
          const cb = await (await fetch('/api/admin/products',{method:'POST',headers:H,
            body:JSON.stringify({type:'combo',name:'ZZ Combo',price:1500,stock:4,cover:cov,posters:[cov],
              bundleItems:['Shirt','Pant'],published:true})})).json();
          const pid = po.product && po.product.id;
          const ed = await (await fetch('/api/admin/products/'+pid,{method:'PUT',headers:H,
            body:JSON.stringify({type:'poster',name:'ZZ Poster EDIT',price:700,stock:9,cover:cov,posters:six,published:true})})).json();
          // image upload
          const cv=document.createElement('canvas'); cv.width=cv.height=32;
          cv.getContext('2d').fillRect(0,0,32,32);
          const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
          const fd=new FormData(); fd.append('images',blob,'zz.png');
          const up=await (await fetch('/api/admin/upload',{method:'POST',headers:{'Authorization':'Bearer '+t},body:fd})).json();
          const served = up.urls && up.urls[0] ? (await fetch(up.urls[0])).status===200 : false;
          const ids=[pid, cl.product&&cl.product.id, cb.product&&cb.product.id].filter(Boolean);
          for(const id of ids) await fetch('/api/admin/products/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+t}});
          const left = await (await fetch('/api/products?limit=200')).json();
          return {po:!!pid, cl:!!(cl.product&&cl.product.id), clStock: cl.product?cl.product.stock:-1,
                  cb:!!(cb.product&&cb.product.id), ed:!!ed.ok&&ed.product.price===700,
                  up:!!(up.urls&&up.urls[0]), served,
                  leftover:(left.items||[]).filter(p=>p.name.startsWith('ZZ ')).length};
        }""")
        chk("poster product create", r["po"])
        chk("clothing create + size stock sum", r["cl"] and r["clStock"] == 7)
        chk("combo create", r["cb"])
        chk("product edit", r["ed"])
        chk("image upload + served", r["up"] and r["served"])
        chk("product delete", r["leftover"] == 0)

        # ---- order + payment verification
        r = pg.evaluate("""async () => {
          const t = HSS.memToken || localStorage.getItem('hss_admin_token');
          const H = {'Content-Type':'application/json','Authorization':'Bearer '+t};
          const o = await (await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:'ZZ Buyer',mobile:'01712223344',division:'Dhaka',district:'Dhaka',
              area:'Gulshan',locality:'Gulshan 2',address:'Road 11 House 3',
              paymentMethod:'bkash',trxId:'ZZTRX99',items:[{id:'p01',qty:1}]})})).json();
          if(!o.order) return {err:o.error};
          const u = await (await fetch('/api/admin/orders/'+o.order.id,{method:'PUT',headers:H,
            body:JSON.stringify({status:'confirmed',paymentStatus:'paid'})})).json();
          return {id:o.order.id, status:u.order&&u.order.status, pay:u.order&&u.order.paymentStatus};
        }""")
        chk("order placed + confirmed + payment verified",
            r.get("status") == "confirmed" and r.get("pay") == "paid")
        pg.evaluate("GOTAB('orders')"); pg.wait_for_timeout(2200)
        body = pg.locator("#pane").inner_text()
        chk("order details visible in admin", r.get("id","") in body and "ZZTRX99" in body and "Gulshan" in body)

        # ---- mobile overflow
        if mob:
            ovf = []
            for t in ["dash","orders","products","analytics","designs","settings"]:
                pg.evaluate(f"GOTAB('{t}')"); pg.wait_for_timeout(900)
                if pg.evaluate("document.documentElement.scrollWidth") > pg.evaluate("document.documentElement.clientWidth") + 1:
                    ovf.append(t)
            chk(f"no mobile overflow ({ovf})", not ovf)

        # ---- logout / re-login
        pg.evaluate("ALOGOUT()"); pg.wait_for_timeout(3500)
        chk("logout -> login page", pg.locator("#u").count() > 0 and pg.locator(".anav").count() == 0)
        pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(2500)
        chk("/admin blocked after logout", pg.locator("#u").count() > 0)
        chk("no scary message after clean logout", not ended(pg))
        login(pg)
        chk("re-login works", pg.locator(".anav").count() > 0)

        # ---- wrong credentials
        pg.evaluate("ALOGOUT()"); pg.wait_for_timeout(3000)
        pg.fill("#u","hssadmin"); pg.fill("#p","wrongpass"); pg.click("#lbtn"); pg.wait_for_timeout(2200)
        msg = pg.locator(".toast").first.inner_text().strip() if pg.locator(".toast").count() else ""
        chk("wrong password rejected", msg == "Wrong username or password" and pg.locator(".anav").count() == 0)

        chk("no JS errors", not errs)
        if errs: print("      ", errs[:3])
        c.close()
    br.close()

print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAIL: {fails}")
sys.exit(1 if fails else 0)
