"""HSS — full admin cycle inside a sandboxed preview iframe (opaque origin,
storage blocked) plus a normal browser. This is the environment that produced
'Could not refresh your session'."""
from playwright.sync_api import sync_playwright
import sys, random

B = "http://localhost:3000"
fails = []
BAD = ["Could not refresh your session", "session ended", "Something went wrong",
       "Cannot reach the server"]
SECTIONS = ["dash","analytics","products","cats","orders","inv","reviews","coupons",
            "customers","carts","designs","home","content","pay","settings"]

def chk(l, c):
    print(("  PASS  " if c else "  FAIL  ") + l)
    if not c: fails.append(l)

def clean(frame):
    t = frame.locator("body").inner_text()
    return [b for b in BAD if b in t]

with sync_playwright() as p:
    br = p.chromium.launch()

    for mode in ["IFRAME-SANDBOX 390px", "NORMAL 390px", "NORMAL 1280px"]:
        print(f"\n===== {mode} =====")
        iframe = mode.startswith("IFRAME")
        vp = {'width':430,'height':900} if iframe else ({'width':390,'height':844} if "390" in mode else {'width':1280,'height':900})
        c = br.new_context(viewport=vp, is_mobile=("390" in mode and not iframe), has_touch="390" in mode)
        pg = c.new_page()
        errs, reqfail = [], []
        pg.on("pageerror", lambda e: errs.append(str(e)[:110]))
        pg.on("requestfailed", lambda r: reqfail.append(r.url.split('/')[-1]) if '/api/' in r.url else None)

        HOST = f'<!doctype html><iframe sandbox="allow-scripts" src="{B}/admin" style="width:390px;height:820px;border:0"></iframe>'
        def frame():
            if iframe:
                pg.goto(B + "/", wait_until="domcontentloaded")
                pg.set_content(HOST); pg.wait_for_timeout(2600)
                return pg.frames[-1]
            pg.goto(B + "/admin", wait_until="networkidle"); pg.wait_for_timeout(900)
            return pg

        f = frame()
        if iframe:
            chk("storage blocked (true sandbox)",
                "THROWS" in f.evaluate("()=>{try{localStorage.setItem('a','1');return 'OK'}catch(e){return 'THROWS'}}"))
        f.fill("#u","hssadmin"); f.fill("#p","admin123"); f.click("#lbtn"); pg.wait_for_timeout(5000)
        chk("login -> dashboard", f.locator(".anav").count() > 0)
        chk("no error banner after login", not clean(f))

        # 60s soak
        bad = 0
        for _ in range(60):
            pg.wait_for_timeout(1000)
            if f.locator(".anav").count() == 0 or clean(f): bad += 1
        chk("60s idle stable", bad == 0)

        # every section
        broken = []
        for t in SECTIONS:
            f.evaluate(f"GOTAB('{t}')"); pg.wait_for_timeout(1000)
            if f.locator(".anav").count() == 0 or f.locator("#pane h1").count() == 0 or clean(f):
                broken.append(t + str(clean(f)))
        chk(f"all 15 sections load ({broken or 'clean'})", not broken)

        # refresh / reload  (reload the SAME frame, like a user pressing refresh)
        if iframe:
            f.evaluate("location.reload()"); pg.wait_for_timeout(5000); f = pg.frames[-1]
        else:
            pg.reload(wait_until="networkidle"); pg.wait_for_timeout(3000)
        chk("session survives reload", f.locator(".anav").count() > 0 and not clean(f))

        # back to dashboard + refresh again
        f.evaluate("GOTAB('dash')"); pg.wait_for_timeout(1500)
        chk("back to dashboard", f.locator(".anav").count() > 0 and not clean(f))

        # CRUD + upload + order + customers + designs
        r = f.evaluate("""async () => {
          const A = (p,o)=>HSS.api(p,Object.assign({admin:true},o||{}));
          const cov='/images/products/her-exe/cover.jpg';
          const six=[1,2,3,4,5,6].map(n=>`/images/products/her-exe/p${n}.jpg`);
          const out={};
          const po=await A('/api/admin/products',{method:'POST',body:{type:'poster',name:'QA6 Poster',
            price:649,stock:5,cover:cov,posters:six,published:true}});
          out.poster=!!(po.product&&po.product.id);
          const cl=await A('/api/admin/products',{method:'POST',body:{type:'clothing',name:'QA6 Tee',
            price:890,stock:0,cover:cov,posters:[cov],sizes:[{size:'S',stock:3},{size:'M',stock:4}],published:true}});
          out.cloth=!!(cl.product&&cl.product.id); out.clothStock=cl.product?cl.product.stock:-1;
          const cb=await A('/api/admin/products',{method:'POST',body:{type:'combo',name:'QA6 Combo',
            price:1500,stock:4,cover:cov,posters:[cov],bundleItems:['Shirt','Pant'],published:true}});
          out.combo=!!(cb.product&&cb.product.id);
          const pid=po.product&&po.product.id;
          const ed=await A('/api/admin/products/'+pid,{method:'PUT',body:{type:'poster',name:'QA6 Poster E',
            price:700,stock:9,cover:cov,posters:six,published:true}});
          out.edit=!!ed.ok && ed.product.price===700;
          const cv=document.createElement('canvas'); cv.width=cv.height=32; cv.getContext('2d').fillRect(0,0,32,32);
          const blob=await new Promise(z=>cv.toBlob(z,'image/png'));
          const fd=new FormData(); fd.append('images',blob,'qa6.png');
          const up=await A('/api/admin/upload',{method:'POST',body:fd});
          out.upload=!!(up.urls&&up.urls[0]);
          out.served=out.upload ? (await fetch(up.urls[0])).status===200 : false;
          const o=await HSS.api('/api/orders',{method:'POST',body:{name:'QA6 Buyer',mobile:'01712223399',
            division:'Dhaka',district:'Dhaka',area:'Gulshan',locality:'Gulshan 2',address:'Road 11 House 3',
            paymentMethod:'bkash',trxId:'QA6TRX',items:[{id:'p01',qty:1}]}});
          out.order=!!(o.order&&o.order.id);
          if(out.order){
            const u=await A('/api/admin/orders/'+o.order.id,{method:'PUT',
              body:{status:'confirmed',paymentStatus:'paid'}});
            out.verify=u.order&&u.order.status==='confirmed'&&u.order.paymentStatus==='paid';
            out.oid=o.order.id;
          }
          out.customers=(await A('/api/admin/customers')).customers!==undefined;
          out.designs=(await A('/api/admin/designs')).designs!==undefined;
          for(const id of [pid, cl.product&&cl.product.id, cb.product&&cb.product.id].filter(Boolean))
            await A('/api/admin/products/'+id,{method:'DELETE'});
          const left=await HSS.api('/api/products?limit=200');
          out.deleted=(left.items||[]).filter(x=>x.name.startsWith('QA6 ')).length===0;
          return out;
        }""")
        chk("poster 6-image create", r["poster"])
        chk("clothing sizes + stock sum", r["cloth"] and r["clothStock"] == 7)
        chk("combo create", r["combo"])
        chk("product edit", r["edit"])
        chk("image upload + served", r["upload"] and r["served"])
        chk("order create + payment verify", r.get("order") and r.get("verify"))
        chk("customers readable", r["customers"])
        chk("custom designs readable", r["designs"])
        chk("product delete", r["deleted"])

        # order visible in UI
        f.evaluate("GOTAB('orders')"); pg.wait_for_timeout(2200)
        chk("order visible in admin UI", r.get("oid","") in f.locator("#pane").inner_text())
        chk("no error banner after CRUD", not clean(f))

        # logout / re-login
        f.evaluate("ALOGOUT()"); pg.wait_for_timeout(4500)
        f2 = pg.frames[-1] if iframe else pg
        if not iframe: pg.wait_for_timeout(1500)
        chk("logout -> login form", f2.locator("#u").count() > 0 and f2.locator(".anav").count() == 0)
        f2.fill("#u","hssadmin"); f2.fill("#p","admin123"); f2.click("#lbtn"); pg.wait_for_timeout(5000)
        chk("re-login works", f2.locator(".anav").count() > 0 and not clean(f2))

        # wrong password
        f2.evaluate("ALOGOUT()"); pg.wait_for_timeout(4500)
        f3 = pg.frames[-1] if iframe else pg
        if not iframe: pg.wait_for_timeout(1200)
        f3.fill("#u","hssadmin"); f3.fill("#p","nope"); f3.click("#lbtn"); pg.wait_for_timeout(2400)
        msg = f3.locator(".toast").first.inner_text().strip() if f3.locator(".toast").count() else ""
        chk("wrong password rejected", msg == "Wrong username or password" and f3.locator(".anav").count() == 0)

        chk("no failed API requests", not reqfail)
        if reqfail: print("      ", reqfail[:5])
        chk("no JS errors", not errs)
        if errs: print("      ", errs[:3])
        c.close()
    br.close()

print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAIL: {fails}")
sys.exit(1 if fails else 0)
