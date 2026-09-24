#!/usr/bin/env python3
"""Generate HSS seed catalog artwork: 20 sets x (cover + 6 A4 posters) + hero banner."""
import os, random, math, shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(20260923)
BASE = "/home/user/hss/public/images/products"
if os.path.exists(BASE):
    shutil.rmtree(BASE)
os.makedirs(BASE, exist_ok=True)

def font(black=True, size=80):
    try:
        p = "/tmp/ArchivoBlack.ttf" if black else "/tmp/SpaceGrotesk.ttf"
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)

def fit_font(draw, text, max_w, black=True, start=96):
    s = start
    while s > 18:
        f = font(black, s)
        bb = draw.textbbox((0,0), text, font=f)
        if bb[2]-bb[0] <= max_w:
            return f
        s -= 6
    return font(black, 18)

def lum(h):
    h = h.lstrip('#')
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    return (0.2126*r+0.7152*g+0.0722*b)/255

def guard(bg, fg, accent):
    """Pick a readable foreground color."""
    if abs(lum(bg)-lum(fg)) >= 0.28:
        return fg
    if abs(lum(bg)-lum(accent)) >= 0.28:
        return accent
    return "#FFFFFF" if lum(bg) < 0.5 else "#111111"

def grain(img, sigma=18, alpha=26):
    n = Image.effect_noise(img.size, sigma).convert("L")
    n = n.point(lambda v: alpha if v > 128 else 0)
    black = Image.new("RGB", img.size, (0,0,0))
    return Image.composite(Image.blend(img, black, 0.12), img, n)

def halftone(draw, w, h, color, gap=22, r=3, region=None):
    x0,y0,x1,y1 = region or (0,0,w,h)
    y = y0; row = 0
    while y < y1:
        x = x0 + (gap//2 if row % 2 else 0)
        while x < x1:
            draw.ellipse([x-r,y-r,x+r,y+r], fill=color)
            x += gap
        y += gap; row += 1

def sparkle(draw, cx, cy, r, color):
    draw.polygon([(cx,cy-r),(cx+r*0.22,cy-r*0.22),(cx+r,cy),(cx+r*0.22,cy+r*0.22),
                  (cx,cy+r),(cx-r*0.22,cy+r*0.22),(cx-r,cy),(cx-r*0.22,cy-r*0.22)], fill=color)

def heart(draw, cx, cy, s, color):
    draw.ellipse([cx-s, cy-s*1.1, cx, cy+s*0.1], fill=color)
    draw.ellipse([cx, cy-s*1.1, cx+s, cy+s*0.1], fill=color)
    draw.polygon([(cx-s*0.95, cy-s*0.05),(cx+s*0.95, cy-s*0.05),(cx, cy+s)], fill=color)

def cherry(draw, cx, cy, s, bg):
    reds = {"#DC2626","#7F1D1D","#EF4444","#831843","#9D174D","#881337","#B91C1C","#991B1B"}
    body = "#FFF1F2" if (lum(bg) < 0.32 or bg.upper() in reds) else "#DC2626"
    stem = "#4D7C0F" if lum(bg) > 0.3 else "#A3E635"
    draw.arc([cx-s, cy-s*1.7, cx+s, cy-s*0.2], 205, 335, fill=stem, width=max(4,int(s*0.13)))
    draw.ellipse([cx-s*0.55, cy-s*1.5, cx+s*0.15, cy-s*1.05], fill=stem)  # leaf
    draw.ellipse([cx-s*1.15, cy-s*0.35, cx-s*0.12, cy+s*0.68], fill=body)
    draw.ellipse([cx+s*0.12, cy-s*0.12, cx+s*1.15, cy+s*0.9], fill=body)
    for ex,ey in [(cx-s*0.88,cy-s*0.12),(cx+s*0.38,cy+0.08)]:
        draw.ellipse([ex-s*0.16,ey-s*0.16,ex+s*0.16,ey+s*0.16], fill=(255,255,255))

def smiley(draw, cx, cy, s, color, bg):
    draw.ellipse([cx-s,cy-s,cx+s,cy+s], fill=color)
    for ex in (-s*0.35, s*0.35):
        draw.ellipse([cx+ex-s*0.12,cy-s*0.3,cx+ex+s*0.12,cy-s*0.02], fill=bg)
    draw.arc([cx-s*0.55,cy-s*0.25,cx+s*0.55,cy+s*0.75], 15, 165, fill=bg, width=max(3,int(s*0.1)))

def sun(draw, cx, cy, s, color):
    for i in range(12):
        a = math.pi*2*i/12
        x1,y1 = cx+math.cos(a)*s*0.75, cy+math.sin(a)*s*0.75
        x2,y2 = cx+math.cos(a)*s*1.15, cy+math.sin(a)*s*1.15
        draw.line([x1,y1,x2,y2], fill=color, width=max(3,int(s*0.1)))
    draw.ellipse([cx-s*0.55,cy-s*0.55,cx+s*0.55,cy+s*0.55], fill=color)

def bolt(draw, cx, cy, s, color):
    draw.polygon([(cx+s*0.25,cy-s),(cx-s*0.35,cy+s*0.15),(cx-s*0.02,cy+s*0.15),
                  (cx-s*0.25,cy+s),(cx+s*0.35,cy-s*0.15),(cx+s*0.02,cy-s*0.15)], fill=color)

def flower(draw, cx, cy, s, color, center):
    for i in range(6):
        a = math.pi*2*i/6
        draw.ellipse([cx+math.cos(a)*s*0.45-s*0.35, cy+math.sin(a)*s*0.45-s*0.35,
                      cx+math.cos(a)*s*0.45+s*0.35, cy+math.sin(a)*s*0.45+s*0.35], fill=color)
    draw.ellipse([cx-s*0.28,cy-s*0.28,cx+s*0.28,cy+s*0.28], fill=center)

def rings(draw, cx, cy, s, color):
    for i in range(4):
        r = s*(0.4+0.22*i)
        draw.ellipse([cx-r,cy-r*0.62,cx+r,cy+r*0.62], outline=color, width=max(3,int(s*0.06)))

def dice(draw, cx, cy, s, color, pip):
    draw.rounded_rectangle([cx-s,cy-s,cx+s,cy+s], radius=int(s*0.25), fill=color)
    o = s*0.45
    for px,py in [(-o,-o),(o,-o),(0,0),(-o,o),(o,o)]:
        draw.ellipse([cx+px-s*0.12,cy+py-s*0.12,cx+px+s*0.12,cy+py+s*0.12], fill=pip)

def bow(draw, cx, cy, s, color):
    draw.polygon([(cx,cy),(cx-s,cy-s*0.6),(cx-s,cy+s*0.6)], fill=color)
    draw.polygon([(cx,cy),(cx+s,cy-s*0.6),(cx+s,cy+s*0.6)], fill=color)
    draw.ellipse([cx-s*0.22,cy-s*0.3,cx+s*0.22,cy+s*0.3], fill=color)

def moon(draw, cx, cy, s, color, bg):
    draw.ellipse([cx-s,cy-s,cx+s,cy+s], fill=color)
    draw.ellipse([cx-s*0.3,cy-s*1.15,cx+s*1.3,cy+s*0.85], fill=bg)

def flame(draw, cx, cy, s, color):
    draw.polygon([(cx,cy-s),(cx+s*0.55,cy-s*0.1),(cx+s*0.35,cy+s*0.5),(cx-s*0.1,cy+s),
                  (cx-s*0.55,cy+s*0.4),(cx-s*0.4,cy-s*0.2)], fill=color)
    draw.ellipse([cx-s*0.2,cy+s*0.05,cx+s*0.2,cy+s*0.5], fill=(255,255,255))

def checker(draw, w, h, c1, y0=0, y1=None, sq=46):
    y1 = y1 or h
    yy = y0; row = 0
    while yy < y1:
        xx = 0; col = row % 2
        while xx < w:
            if (col % 2) == 0:
                draw.rectangle([xx,yy,xx+sq,yy+sq], fill=c1)
            xx += sq; col += 1
        yy += sq; row += 1

def stripes(draw, w, h, color, vertical=True, gap=34, width=14, region=None):
    x0,y0,x1,y1 = region or (0,0,w,h)
    if vertical:
        x = x0
        while x < x1:
            draw.rectangle([x,y0,x+width,y1], fill=color); x += gap
    else:
        y = y0
        while y < y1:
            draw.rectangle([x0,y,x1,y+width], fill=color); y += gap

MOTIFS = ["heart","cherry","checker","stripes","sun","moon","sparkle","bow","smiley",
          "bolt","flower","rings","dice","flame","halftone","grid","wave","band"]

def draw_motif(draw, motif, w, h, fg, bg, accent):
    cx, cy = w//2, int(h*0.38)
    s = 115
    if motif=="heart":
        heart(draw,cx,cy,s,fg); heart(draw,cx-160,cy+150,34,accent); heart(draw,cx+165,cy-140,26,accent)
    elif motif=="cherry": cherry(draw,cx,cy,s,bg)
    elif motif=="checker":
        checker(draw,w,h,fg,y0=int(h*0.16),y1=int(h*0.58),sq=52)
        draw.rectangle([0,int(h*0.16)-6,w,int(h*0.16)+6],fill=accent)
        draw.rectangle([0,int(h*0.58)-6,w,int(h*0.58)+6],fill=accent)
    elif motif=="stripes": stripes(draw,w,h,fg,vertical=True,gap=44,width=20,region=(0,int(h*0.14),w,int(h*0.58)))
    elif motif=="sun": sun(draw,cx,cy,s,fg)
    elif motif=="moon": moon(draw,cx,cy,s,fg,bg)
    elif motif=="sparkle":
        sparkle(draw,cx,cy,115,fg); sparkle(draw,cx-145,cy+125,45,accent); sparkle(draw,cx+150,cy-115,58,accent)
    elif motif=="bow": bow(draw,cx,cy,s,fg)
    elif motif=="smiley": smiley(draw,cx,cy,s,fg,bg)
    elif motif=="bolt":
        bolt(draw,cx,cy,s,fg); bolt(draw,cx-165,cy+130,40,accent); bolt(draw,cx+170,cy-120,32,accent)
    elif motif=="flower": flower(draw,cx,cy,s,fg,accent)
    elif motif=="rings": rings(draw,cx,cy,s,fg)
    elif motif=="dice": dice(draw,cx,cy,s,fg,bg)
    elif motif=="flame": flame(draw,cx,cy,s,fg)
    elif motif=="halftone":
        halftone(draw,w,h,fg,gap=26,r=4,region=(0,int(h*0.12),w,int(h*0.58)))
    elif motif=="grid":
        for x in range(0,w,46): draw.line([x,int(h*0.12),x,int(h*0.58)],fill=fg,width=3)
        for y in range(int(h*0.12),int(h*0.58),46): draw.line([0,y,w,y],fill=fg,width=3)
    elif motif=="wave":
        for i in range(6):
            y = int(h*0.18)+i*44
            draw.arc([-w*0.25,y,w*1.25,y+120],180,360,fill=fg,width=8)
    elif motif=="band":
        draw.rectangle([0,int(h*0.28),w,int(h*0.52)],fill=fg)
        for i in range(5):
            sparkle(draw, w*0.2+i*w*0.15, int(h*0.40), 30, bg)

SETS = [
 ("her-exe","HER.EXE","for the girls who get it", ["#F9A8D4","#FCE7F3","#F472B6","#F9A8D4","#FFF1F2","#FBCFE8"], "#111111", "#BE185D"),
 ("pink-exe-vol-1","PINK.EXE VOL.1","too glam to beg", ["#FBCFE8","#F472B6","#FDF2F8","#EC4899","#F9A8D4","#FDA4AF"], "#5B0B2A", "#FFF1F2"),
 ("pink-exe-vol-2","PINK.EXE VOL.2","certified lover girl", ["#FDF2F8","#F9A8D4","#111111","#FBCFE8","#DB2777","#FCE7F3"], "#111111", "#F472B6"),
 ("y2k-dreams","Y2K DREAMS","dial-up daydreams", ["#C4B5FD","#E9D5FF","#1E1B4B","#A78BFA","#F5D0FE","#DDD6FE"], "#1E1B4B", "#7C3AED"),
 ("tokyo-neon","TOKYO NEON","after midnight in shibuya", ["#0F0F14","#18181B","#7C3AED","#0F0F14","#27272A","#4C1D95"], "#E9D5FF", "#D7FF3E"),
 ("anime-after-dark","ANIME AFTER DARK","main character energy", ["#1E1B4B","#0F0F14","#312E81","#7C3AED","#111111","#4C1D95"], "#F5F3FF", "#F0ABFC"),
 ("coquette-club","COQUETTE CLUB","ribbons and daydreams", ["#FFF1F2","#FFE4E6","#FECDD3","#FFF7ED","#FCE7F3","#FDA4AF"], "#881337", "#FB7185"),
 ("cherry-bomb","CHERRY BOMB","sweet with a bite", ["#DC2626","#FFF1F2","#7F1D1D","#FECACA","#991B1B","#EF4444"], "#FFF1F2", "#FCA5A5"),
 ("vintage-vogue","VINTAGE VOGUE","old money walls", ["#F5F0E8","#E7E0D0","#1C1917","#D6CDB8","#FAF7F0","#44403C"], "#1C1917", "#A8A29E"),
 ("streetwear-icons","STREETWEAR ICONS","born on the streets", ["#111111","#F5F5F4","#1C1917","#D7FF3E","#111111","#E7E5E4"], "#F5F5F4", "#D7FF3E"),
 ("grunge-archive","GRUNGE ARCHIVE","perfectly undone", ["#292524","#1C1917","#44403C","#0C0A09","#57534E","#1C1917"], "#E7E5E4", "#A8A29E"),
 ("indie-bedroom","INDIE BEDROOM","songs to stare at walls to", ["#FDE68A","#FEF3C7","#92400E","#F59E0B","#FFFBEB","#B45309"], "#451A03", "#F97316"),
 ("dark-academia","DARK ACADEMIA","romanticise everything", ["#1C1917","#292524","#0C0A09","#44403C","#1C1917","#3B2F2F"], "#E7E5E4", "#B45309"),
 ("minimal-beige","MINIMAL BEIGE","quiet luxury walls", ["#F5F0E8","#EDE6D8","#FAF7F0","#E2D9C8","#F1EAD9","#D9CFBB"], "#44403C", "#A8A29E"),
 ("football-culture","FOOTBALL CULTURE","for the beautiful game", ["#052E16","#F5F5F4","#14532D","#052E16","#166534","#111111"], "#F5F5F4", "#D7FF3E"),
 ("hiphop-legends","HIP-HOP LEGENDS","from the block to the wall", ["#111111","#FFFBEB","#1C1917","#B45309","#0C0A09","#F59E0B"], "#FFFBEB", "#F59E0B"),
 ("saturn-return","SATURN RETURN","cosmic girl era", ["#2E1065","#4C1D95","#0F0F14","#7C3AED","#1E1B4B","#6D28D9"], "#F5F3FF", "#D7FF3E"),
 ("film-noir","FILM NOIR","cinema for your walls", ["#0C0A09","#1C1917","#F5F5F4","#111111","#292524","#0C0A09"], "#F5F5F4", "#D7FF3E"),
 ("kpop-room","IDOL ROOM","stan wall essentials", ["#F0ABFC","#FDF4FF","#A855F7","#F5D0FE","#7E22CE","#FAE8FF"], "#3B0764", "#701A75"),
 ("retro-summer","RETRO SUMMER","endless golden hour", ["#FB923C","#FFEDD5","#EA580C","#FDBA74","#9A3412","#FED7AA"], "#431407", "#FFF7ED"),
]

WORDS = {
 "her-exe": [("CALL ME","IF YOU GET LOST"),("TIME CASTS","ITS SPELL"),("SATURN","GIRL"),("ALL","BLUSH"),("VOGUE","MUSE"),("SHE IS","THE MOMENT")],
 "pink-exe-vol-1": [("TOO GLAM","TO BEG"),("JUST","A GIRL"),("LOVE","LOVE"),("VIBES","ONLY"),("XOXO","BABY"),("PINK","PILLED")],
 "pink-exe-vol-2": [("LILY","LALA"),("NEW","YORK"),("SZA","SEASON"),("10 THINGS","I HATE"),("VOGUE","VOGUE"),("WHEN YOU","ARE GONE")],
 "y2k-dreams": [("DIAL","UP"),("CYBER","DOLL"),("LOW","RISE"),("FLIP","PHONE"),("BUTTERFLY","CLIPS"),("POP","PRINCESS")],
 "tokyo-neon": [("SHIBUYA","3AM"),("NEON","DISTRICT"),("MIDNIGHT","RAMEN"),("LOST IN","TRANSLATION"),("KANJI","NIGHTS"),("AKIRA","SLIDE")],
 "anime-after-dark": [("PLUS","ULTRA"),("SHINIGAMI","MODE"),("TITAN","HUNT"),("CURSED","ENERGY"),("FINAL","ARC"),("ZERO TWO","ERA")],
 "coquette-club": [("RIBBONS","AND ROSES"),("SOFT","LAUNCH"),("BALLET","CORE"),("LACE","AND PEARLS"),("DOLLETTE","ERA"),("KISS","AND TELL")],
 "cherry-bomb": [("CHERRY","BOMB"),("BITE","ME"),("SWEET","AND SOUR"),("RED","VELVET"),("JUICY","COUTURE"),("PICKED","FRESH")],
 "vintage-vogue": [("VOGUE","1974"),("OLD","MONEY"),("RIVIERA","CLUB"),("COCO","NOIR"),("GOLDEN","HOUR"),("PARIS","TEXAS")],
 "streetwear-icons": [("BORN ON","THE STREETS"),("HSS","WORLDWIDE"),("NO","HALFTIME"),("QUALITY","CULTURE"),("EST","2025"),("HIGHSTREET","SOCIETY")],
 "grunge-archive": [("TEEN","SPIRIT"),("RIPPED","JEANS"),("GARAGE","DAYS"),("STATIC","NOISE"),("MOSH","PIT"),("UNPLUGGED","1993")],
 "indie-bedroom": [("CEILINGS","AND FLOORS"),("MIXTAPE","VOL 2"),("SLOW","MORNINGS"),("VINYL","ONLY"),("DAYDREAM","NATION"),("BEDROOM","POP")],
 "dark-academia": [("DEAD POETS","SOCIETY"),("CARPE","DIEM"),("GOTHIC","HALLS"),("INK AND","IVY"),("CLASSICS","ONLY"),("CANDLELIT","CHAPTERS")],
 "minimal-beige": [("LESS","BUT BETTER"),("QUIET","LUXURY"),("FORM","AND FUNCTION"),("CALM","CLUB"),("OAT MILK","EVERYTHING"),("BEIGE","FLAG")],
 "football-culture": [("BEAUTIFUL","GAME"),("90 PLUS 2","MINUTES"),("ULTRAS","MENTALITY"),("SUNDAY","LEAGUE"),("TOP","BINS"),("DERBY","DAYS")],
 "hiphop-legends": [("STRAIGHT","OUTTA"),("GOLDEN","ERA"),("BOOM","BAP"),("MIXTAPE","MASSACRE"),("FROM THE","BLOCK"),("8 MILE","HIGH")],
 "saturn-return": [("SATURN","RETURN"),("COSMIC","GIRL"),("STARDUST","MEMORIES"),("ORBIT","BREAKER"),("NEBULA","HEARTS"),("PLANET","HSS")],
 "film-noir": [("FINAL","GIRL"),("NEON","NOIR"),("CULT","CLASSIC"),("REEL","TALK"),("AFTER","CREDITS"),("CUT","PRINT")],
 "kpop-room": [("STAN","WALL"),("COMEBACK","SEASON"),("LIGHTSTICK","ON"),("BIAS","WRECKER"),("ENCORE","STAGE"),("FANCHANT","READY")],
 "retro-summer": [("GOLDEN","HOUR"),("SALTY","HAIR"),("PALM","SHADOWS"),("ENDLESS","SUMMER"),("SUNFADED","TEES"),("WAVES","AND DAYS")],
}

W,H = 620,877

def make_poster(bg, fg, accent, line1, line2, motif, setname, idx):
    TC = guard(bg, fg, accent)
    img = Image.new("RGB",(W,H),bg)
    d = ImageDraw.Draw(img)
    for i in range(6):
        y = int(H*0.055)+i*8
        d.line([28,y,W-28,y], fill=accent, width=2)
    draw_motif(d, motif, W, H, TC, bg, accent)
    f1 = fit_font(d, line1, W-90, True, 92)
    f2 = fit_font(d, line2, W-90, True, 92)
    bb1 = d.textbbox((0,0),line1,font=f1); bb2 = d.textbbox((0,0),line2,font=f2)
    y = int(H*0.64)
    d.text((W/2-(bb1[2]-bb1[0])/2, y), line1, font=f1, fill=TC)
    y += (bb1[3]-bb1[1]) + 8
    d.text((W/2-(bb2[2]-bb2[0])/2, y), line2, font=f2, fill=TC)
    f3 = font(False, 24)
    tag = f"HIGHSTREET SOCIETY - {setname} - 0{idx+1}/06"
    bb3 = d.textbbox((0,0),tag,font=f3)
    d.rectangle([W/2-(bb3[2]-bb3[0])/2-16, H-70, W/2+(bb3[2]-bb3[0])/2+16, H-32], fill=TC)
    d.text((W/2-(bb3[2]-bb3[0])/2, H-66), tag, font=f3, fill=bg)
    d.rectangle([10,10,W-11,H-11], outline=TC, width=4)
    return grain(img)

def make_cover(slug, name, tagline, posters):
    S, CW = 1080, 1350
    img = Image.new("RGB",(S,CW),"#6D28D9")
    d = ImageDraw.Draw(img)
    for i,c in enumerate(["#7C3AED","#8B5CF6","#6D28D9","#5B21B6"]):
        d.ellipse([-340+i*130,-300+i*90,S+340-i*70,CW+300-i*50], outline=c, width=36)
    for _ in range(46):
        sparkle(d, random.randint(0,S), random.randint(0,CW), random.randint(4,20), "#D7FF3E" if random.random()<0.4 else "#E9D5FF")
    fh = font(True, 62)
    t = "HIGHSTREET SOCIETY"
    bb = d.textbbox((0,0),t,font=fh)
    y0 = 54
    d.rectangle([S/2-(bb[2]-bb[0])/2-26, y0-12, S/2+(bb[2]-bb[0])/2+26, y0+(bb[3]-bb[1])+16], fill="#0F0F14")
    d.text((S/2-(bb[2]-bb[0])/2, y0), t, font=fh, fill="#F5F3FF")
    fs = font(True, 46)
    bb2 = d.textbbox((0,0),name,font=fs)
    d.text((S/2-(bb2[2]-bb2[0])/2, y0+(bb[3]-bb[1])+40), name, font=fs, fill="#D7FF3E")
    ft = font(False, 32)
    bb3 = d.textbbox((0,0),tagline,font=ft)
    d.text((S/2-(bb3[2]-bb3[0])/2, y0+(bb[3]-bb[1])+104), tagline, font=ft, fill="#E9D5FF")
    gap = 20
    cw = 322
    chh = int(cw*877/620)
    gx = (S - (3*cw+2*gap))//2
    gy = 330
    for i,p in enumerate(posters):
        r,c = divmod(i,3)
        x = gx+c*(cw+gap); y = gy+r*(chh+gap)
        th = p.resize((cw,chh), Image.LANCZOS)
        img.paste(th,(x,y))
        ImageDraw.Draw(img).rectangle([x,y,x+cw,y+chh], outline="#0F0F14", width=5)
    d.rectangle([0,CW-100,S,CW], fill="#0F0F14")
    ff = font(False, 32)
    ftt = "6 PREMIUM POSTERS - A4 - 3MM BOARD"
    bbf = d.textbbox((0,0),ftt,font=ff)
    d.text((S/2-(bbf[2]-bbf[0])/2, CW-70), ftt, font=ff, fill="#F5F3FF")
    return grain(img, sigma=14, alpha=20)

motif_pool = MOTIFS[:]
for slug,name,tagline,palette,fg,accent in SETS:
    random.shuffle(motif_pool)
    words = WORDS[slug]
    d = os.path.join(BASE, slug); os.makedirs(d, exist_ok=True)
    posters = []
    for i in range(6):
        p = make_poster(palette[i], fg, accent, words[i][0], words[i][1], motif_pool[i % len(motif_pool)], name, i)
        p.save(os.path.join(d, f"p{i+1}.jpg"), quality=90)
        posters.append(p)
    make_cover(slug, name, tagline, posters).save(os.path.join(d, "cover.jpg"), quality=90)
    print("done", slug)

HB = Image.new("RGB",(1600,900),"#0B0B0F")
dh = ImageDraw.Draw(HB)
for i,c in enumerate(["#1E1B4B","#312E81","#4C1D95"]):
    dh.ellipse([-500+i*150,-700+i*120,2100-i*150,1600-i*100], outline=c, width=26)
for _ in range(70):
    sparkle(dh, random.randint(0,1600), random.randint(0,900), random.randint(3,14), "#D7FF3E" if random.random()<0.35 else "#8B5CF6")
fh1 = font(True,150); fh2 = font(True,150)
dh.text((90,180),"WALLS THAT",font=fh1,fill="#F5F3FF")
dh.text((90,340),"TALK BACK.",font=fh2,fill="#D7FF3E")
fb = font(False,44)
dh.text((96,540),"A4 poster sets - 6 designs - 3mm board",font=fb,fill="#A1A1AA")
dh.rounded_rectangle([90,640,560,730],radius=40,fill="#D7FF3E")
fbtn = font(True,44)
dh.text((150,656),"SHOP SETS",font=fbtn,fill="#0B0B0F")
samples = []
for s in ["her-exe","tokyo-neon","cherry-bomb","saturn-return"]:
    samples.append(Image.open(os.path.join(BASE,s,"p1.jpg")))
for i,p in enumerate(samples):
    th = p.resize((250,353), Image.LANCZOS)
    th = th.rotate(-10+i*7, expand=True, fillcolor=(11,11,15))
    HB.paste(th,(1050+(i%2)*230, 120+(i//2)*380))
HB.save("/home/user/hss/public/images/hero-banner.jpg", quality=90)
print("hero done")
