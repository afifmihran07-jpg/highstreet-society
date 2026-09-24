"""HSS — customer profile + checkout autofill + guest checkout + order snapshot."""
from playwright.sync_api import sync_playwright
import random, sys
B="http://localhost:3000"
fails=[]
def chk(l,c,x=""):
    print(("  PASS  " if c else "  FAIL  ")+l+(f"   [{x}]" if x and not c else ""))
    if not c: fails.append(l)

MOB="016"+str(random.randint(10000000,99999999))
NAME="Tanvir Hasan"

with sync_playwright() as p:
    br=p.chromium.launch()
    c=br.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    pg=c.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)[:110]))

    # ---------- TEST A: register -> profile ----------
    print("TEST A — NEW REGISTERED CUSTOMER")
    pg.goto(B+"/account", wait_until="networkidle"); pg.wait_for_timeout(1200)
    pg.locator("text=Create an account").first.click(); pg.wait_for_timeout(600)
    pg.fill("#a_name",NAME); pg.fill("#a_mobile",MOB); pg.fill("#a_pw","secret123")
    pg.locator("button:has-text('Create account')").click(); pg.wait_for_timeout(3500)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1500)
    txt=pg.locator(".pfcard").inner_text()
    chk("profile shows real name", NAME in txt, txt[:90])
    chk("profile shows real mobile", MOB in txt)
    chk("read-only view (Edit button present)", pg.locator("#pf_edit").count()==1)
    chk("empty fields marked, not fake data", "Not added yet" in txt or "Not selected" in txt)

    print("   fill full delivery profile")
    pg.locator("#pf_edit").click(); pg.wait_for_timeout(1500)
    pg.select_option("#pf_div","Dhaka"); pg.wait_for_timeout(600)
    pg.select_option("#pf_dist","Dhaka"); pg.wait_for_timeout(600)
    pg.select_option("#pf_area","Mohammadpur"); pg.wait_for_timeout(400)
    pg.fill("#pf_local","Shia Masjid"); pg.fill("#pf_landmark","beside the mosque")
    pg.fill("#pf_addr","House 12, Road 5, 3rd floor")
    pg.locator("#pf_save").click(); pg.wait_for_timeout(3000)
    txt=pg.locator(".pfcard").inner_text() if pg.locator(".pfcard").count() else pg.locator("body").inner_text()
    chk("saved values shown immediately", "Mohammadpur" in txt and "Shia Masjid" in txt, txt[:120])

    print("   refresh")
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(2500)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1500)
    txt=pg.locator(".pfcard").inner_text()
    chk("profile persists after refresh", "Mohammadpur" in txt and "House 12" in txt)

    print("   logout -> login")
    pg.evaluate("HSS.logout()"); pg.wait_for_timeout(2500)
    pg.goto(B+"/account", wait_until="networkidle"); pg.wait_for_timeout(1500)
    pg.fill("#a_mobile",MOB); pg.fill("#a_pw","secret123")
    pg.locator("button:has-text('Login')").first.click(); pg.wait_for_timeout(3500)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1500)
    txt=pg.locator(".pfcard").inner_text()
    chk("profile persists after re-login", "Mohammadpur" in txt and "Shia Masjid" in txt)

    # ---------- TEST B: edit ----------
    print("\nTEST B — EDIT PROFILE")
    pg.locator("#pf_edit").click(); pg.wait_for_timeout(1500)
    pg.fill("#pf_name","Tanvir H. Rahman")
    pg.fill("#pf_addr","House 99, Road 1, Ground floor")
    pg.locator("#pf_save").click(); pg.wait_for_timeout(3000)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1200)
    txt=pg.locator(".pfcard").inner_text()
    chk("edit applied immediately", "Tanvir H. Rahman" in txt and "House 99" in txt)
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(2500)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1500)
    chk("edit persists after refresh", "House 99" in pg.locator(".pfcard").inner_text())
    print("   validation")
    pg.locator("#pf_edit").click(); pg.wait_for_timeout(1200)
    pg.fill("#pf_name","A"); pg.locator("#pf_save").click(); pg.wait_for_timeout(1200)
    chk("rejects too-short name", pg.locator("#pf_err").is_visible())
    pg.locator("#pf_cancel").click(); pg.wait_for_timeout(1000)
    chk("cancel returns to read-only", pg.locator("#pf_edit").count()==1)
    chk("cancel discarded the bad edit", "Tanvir H. Rahman" in pg.locator(".pfcard").inner_text())

    # ---------- TEST C: logged-in checkout autofill ----------
    print("\nTEST C — LOGGED-IN CHECKOUT AUTOFILL")
    pg.goto(B+"/product/her-exe", wait_until="networkidle"); pg.wait_for_timeout(1500)
    pg.locator("button:has-text('Add to Cart')").first.click(); pg.wait_for_timeout(900)
    pg.goto(B+"/checkout", wait_until="networkidle"); pg.wait_for_timeout(2500)
    chk("name auto-filled", pg.input_value("#f_name")=="Tanvir H. Rahman", pg.input_value("#f_name"))
    chk("mobile auto-filled", pg.input_value("#f_mobile")==MOB)
    chk("address auto-filled", "House 99" in pg.input_value("#f_addr"))
    chk("locality auto-filled", pg.input_value("#f_local")=="Shia Masjid")
    chk("landmark auto-filled", "mosque" in pg.input_value("#f_landmark"))
    chk("division auto-filled", pg.input_value("#f_div")=="Dhaka")
    chk("district auto-filled", pg.input_value("#f_dist")=="Dhaka")
    chk("thana auto-filled", pg.input_value("#f_area")=="Mohammadpur")
    chk("delivery zone computed from profile", "Inside Dhaka" in pg.locator("#zonebox").inner_text())

    print("   override address for THIS order only")
    pg.fill("#f_addr","TEMP House 7, Banani Road 11")
    pg.locator(".paym:has-text('bKash')").click(); pg.wait_for_timeout(600)
    trx="BK"+str(random.randint(100000,999999)); pg.fill("#f_trx",trx)
    pg.click("#place"); pg.wait_for_timeout(4500)
    chk("order placed", "/success" in pg.url, pg.url)
    oid1 = pg.url.split("id=")[1].split("&")[0] if "id=" in pg.url else None

    print("   profile must NOT be overwritten by the one-off change")
    pg.goto(B+"/account", wait_until="networkidle"); pg.wait_for_timeout(2500)
    pg.locator("button[data-t='profile']").click(); pg.wait_for_timeout(1500)
    txt=pg.locator(".pfcard").inner_text()
    chk("saved profile address unchanged", "House 99" in txt and "TEMP House 7" not in txt)

    # ---------- TEST D: order snapshot ----------
    print("\nTEST D — ORDER SNAPSHOT")
    pg.locator("#pf_edit").click(); pg.wait_for_timeout(1500)
    pg.select_option("#pf_div","Dhaka"); pg.wait_for_timeout(600)
    pg.select_option("#pf_dist","Dhaka"); pg.wait_for_timeout(600)
    pg.select_option("#pf_area","Dhanmondi"); pg.wait_for_timeout(400)
    pg.fill("#pf_local","Dhanmondi 27"); pg.fill("#pf_addr","House 500, Road 8")
    pg.locator("#pf_save").click(); pg.wait_for_timeout(3000)
    snap = pg.evaluate("""async (oid)=>{ const d=await HSS.api('/api/orders/mine');
        const o=(d.orders||[]).find(x=>x.id===oid); return o?o.customer:null; }""", oid1)
    chk("old order keeps its original address", snap and "TEMP House 7" in snap["address"], str(snap))
    chk("old order keeps original thana", snap and snap["area"]=="Mohammadpur", str(snap and snap.get("area")))
    print("   new checkout uses the UPDATED profile")
    pg.goto(B+"/product/her-exe", wait_until="networkidle"); pg.wait_for_timeout(1400)
    pg.locator("button:has-text('Add to Cart')").first.click(); pg.wait_for_timeout(800)
    pg.goto(B+"/checkout", wait_until="networkidle"); pg.wait_for_timeout(2500)
    chk("checkout now uses new address", "House 500" in pg.input_value("#f_addr"))
    chk("checkout now uses new thana", pg.input_value("#f_area")=="Dhanmondi")
    c.close()

    # ---------- TEST E: guest checkout ----------
    print("\nTEST E — GUEST CHECKOUT (must still work)")
    g=br.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    gp=g.new_page(); gerr=[]
    gp.on("pageerror", lambda e: gerr.append(str(e)[:110]))
    gp.goto(B+"/product/her-exe", wait_until="networkidle"); gp.wait_for_timeout(1500)
    gp.locator("button:has-text('Add to Cart')").first.click(); gp.wait_for_timeout(900)
    gp.goto(B+"/checkout", wait_until="networkidle"); gp.wait_for_timeout(2200)
    chk("guest not forced to log in", gp.locator("#f_name").count()==1)
    chk("guest fields start empty", gp.input_value("#f_name")=="")
    gmob="019"+str(random.randint(10000000,99999999))
    gp.fill("#f_name","Guest Shopper"); gp.fill("#f_mobile",gmob)
    gp.select_option("#f_div","Chattogram"); gp.wait_for_timeout(500)
    gp.select_option("#f_dist","Cox's Bazar"); gp.wait_for_timeout(500)
    gp.fill("#f_areaq","tekn"); gp.wait_for_timeout(700)
    gp.fill("#f_local","Teknaf Bazar"); gp.fill("#f_addr","Main Road, 2nd floor")
    gp.click("#place"); gp.wait_for_timeout(4500)
    chk("guest order placed", "/success" in gp.url, gp.url)
    goid = gp.url.split("id=")[1].split("&")[0] if "id=" in gp.url else None
    chk("guest never had to register", gp.evaluate("!HSS.store.get('hss_token')"))
    chk("no JS errors (guest)", not gerr, str(gerr[:2]))
    g.close()

    # ---------- admin verification ----------
    print("\nADMIN → ORDERS verification")
    a=br.new_context(viewport={'width':1280,'height':900}); ap=a.new_page()
    ap.goto(B+"/admin", wait_until="networkidle"); ap.wait_for_timeout(700)
    ap.fill("#u","hssadmin"); ap.fill("#p","admin123"); ap.click("#lbtn"); ap.wait_for_timeout(4000)
    ap.evaluate("GOTAB('orders')"); ap.wait_for_timeout(2500)
    ob=ap.locator("#pane").inner_text()
    chk("logged-in order in admin", oid1 and oid1 in ob)
    chk("admin shows the FINAL checkout address", "TEMP House 7" in ob)
    chk("guest order in admin", goid and goid in ob)
    chk("guest details in admin", "Guest Shopper" in ob and "Teknaf" in ob)
    linked = ap.evaluate("""async (oid)=>{ const d=await HSS.api('/api/admin/orders',{admin:true});
        const o=(d.orders||[]).find(x=>x.id===oid); return o?o.customer:null; }""", oid1)
    chk("order linked to customer account", linked and linked.get("customerId"), str(linked and linked.get("customerId")))
    gl = ap.evaluate("""async (oid)=>{ const d=await HSS.api('/api/admin/orders',{admin:true});
        const o=(d.orders||[]).find(x=>x.id===oid); return o?o.customer:null; }""", goid)
    chk("guest order has NO customer account", gl and not gl.get("customerId"))
    a.close()


    # ---------- TEST F: existing customer + opt-in save-to-profile ----------
    print("\nTEST F — EXISTING CUSTOMER + OPT-IN PROFILE SAVE")
    f=br.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    fp=f.new_page(); ferr=[]
    fp.on("pageerror", lambda e: ferr.append(str(e)[:110]))
    fp.goto(B+"/account", wait_until="networkidle"); fp.wait_for_timeout(1500)
    fp.fill("#a_mobile",MOB); fp.fill("#a_pw","secret123")
    fp.locator("button:has-text('Login')").first.click(); fp.wait_for_timeout(3500)
    fp.locator("button[data-t='profile']").click(); fp.wait_for_timeout(1500)
    txt=fp.locator(".pfcard").inner_text()
    chk("F: existing account shows stored info", "House 500" in txt and "Dhanmondi" in txt, txt[:100])

    print("   opt-in checkbox appears for logged-in customer")
    fp.goto(B+"/product/her-exe", wait_until="networkidle"); fp.wait_for_timeout(1400)
    fp.locator("button:has-text('Add to Cart')").first.click(); fp.wait_for_timeout(800)
    fp.goto(B+"/checkout", wait_until="networkidle"); fp.wait_for_timeout(2500)
    chk("F: save-to-profile checkbox present", fp.locator("#f_savepf").count()==1)
    chk("F: checkbox is OFF by default (never forced)", not fp.is_checked("#f_savepf"))
    chk("F: checkout auto-filled from profile", "House 500" in fp.input_value("#f_addr"))

    print("   tick it, change address, place order -> profile SHOULD update")
    fp.fill("#f_addr","House 777, Road 12, Banani")
    fp.check("#f_savepf")
    fp.click("#place"); fp.wait_for_timeout(4500)
    chk("F: order placed with opt-in", "/success" in fp.url, fp.url)
    fp.goto(B+"/account", wait_until="networkidle"); fp.wait_for_timeout(2500)
    fp.locator("button[data-t='profile']").click(); fp.wait_for_timeout(1500)
    txt=fp.locator(".pfcard").inner_text()
    chk("F: profile updated because customer opted in", "House 777" in txt, txt[:120])
    chk("F: no JS errors", not ferr, str(ferr[:2]))
    f.close()

    chk("no JS errors (customer)", not errs, str(errs[:2]))
    br.close()
print("\nRESULT:", "ALL PASS" if not fails else f"{len(fails)} FAIL: {fails}")
sys.exit(1 if fails else 0)
