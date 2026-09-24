#!/usr/bin/env node
/* Seed HSS database: 20 poster sets, categories, homepage CMS, settings, coupons. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hash(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}

const SETS = [
  { slug:'her-exe',          name:'HER.EXE',          tag:'for the girls who get it',        price:649, sale:549, stock:42, cats:['coquette-pink'], tags:['coquette','pink','vogue','girly','pinterest'], featured:true,  isNew:false, best:true  },
  { slug:'pink-exe-vol-1',   name:'PINK.EXE VOL.1',   tag:'too glam to beg',                 price:649, sale:0,   stock:38, cats:['coquette-pink'], tags:['pink','coquette','y2k','girly'], featured:true, isNew:false, best:true  },
  { slug:'pink-exe-vol-2',   name:'PINK.EXE VOL.2',   tag:'certified lover girl',            price:649, sale:0,   stock:35, cats:['coquette-pink'], tags:['pink','sza','new york','lover'], featured:false, isNew:true, best:false },
  { slug:'coquette-club',    name:'COQUETTE CLUB',    tag:'ribbons and daydreams',           price:649, sale:0,   stock:29, cats:['coquette-pink'], tags:['coquette','ballet','soft','ribbons'], featured:false, isNew:true, best:false },
  { slug:'cherry-bomb',      name:'CHERRY BOMB',      tag:'sweet with a bite',               price:649, sale:549, stock:51, cats:['coquette-pink'], tags:['cherry','red','y2k','bold'], featured:true, isNew:false, best:true  },
  { slug:'kpop-room',        name:'IDOL ROOM',        tag:'stan wall essentials',            price:699, sale:0,   stock:33, cats:['music-cinema'], tags:['kpop','idol','stan','fanchant'], featured:false, isNew:true, best:false },
  { slug:'tokyo-neon',       name:'TOKYO NEON',       tag:'after midnight in shibuya',       price:699, sale:0,   stock:27, cats:['anime-gaming'], tags:['tokyo','neon','japan','night','aesthetic'], featured:true, isNew:false, best:false },
  { slug:'anime-after-dark', name:'ANIME AFTER DARK', tag:'main character energy',           price:699, sale:599, stock:31, cats:['anime-gaming'], tags:['anime','manga','otaku','dark'], featured:false, isNew:false, best:true  },
  { slug:'y2k-dreams',       name:'Y2K DREAMS',       tag:'dial-up daydreams',               price:649, sale:0,   stock:24, cats:['anime-gaming'], tags:['y2k','retro','2000s','cyber'], featured:false, isNew:true, best:false },
  { slug:'streetwear-icons', name:'STREETWEAR ICONS', tag:'born on the streets',             price:749, sale:0,   stock:40, cats:['street-urban'], tags:['streetwear','hss','urban','brand'], featured:true, isNew:false, best:false },
  { slug:'grunge-archive',   name:'GRUNGE ARCHIVE',   tag:'perfectly undone',                price:649, sale:0,   stock:22, cats:['street-urban'], tags:['grunge','rock','90s','dark'], featured:false, isNew:false, best:false },
  { slug:'football-culture', name:'FOOTBALL CULTURE', tag:'for the beautiful game',          price:699, sale:0,   stock:26, cats:['street-urban'], tags:['football','soccer','ultras','sport'], featured:false, isNew:true, best:false },
  { slug:'hiphop-legends',   name:'HIP-HOP LEGENDS',  tag:'from the block to the wall',      price:699, sale:0,   stock:4,  cats:['music-cinema','street-urban'], tags:['hiphop','rap','90s','golden era'], featured:false, isNew:false, best:true },
  { slug:'film-noir',        name:'FILM NOIR',        tag:'cinema for your walls',           price:699, sale:0,   stock:0,  cats:['music-cinema'], tags:['cinema','movies','noir','film'], featured:false, isNew:false, best:false },
  { slug:'indie-bedroom',    name:'INDIE BEDROOM',    tag:'songs to stare at walls to',      price:649, sale:0,   stock:28, cats:['music-cinema'], tags:['indie','music','bedroom','mixtape'], featured:false, isNew:false, best:false },
  { slug:'vintage-vogue',    name:'VINTAGE VOGUE',    tag:'old money walls',                 price:749, sale:649, stock:19, cats:['minimal-aesthetic'], tags:['vintage','vogue','paris','luxury'], featured:true, isNew:false, best:false },
  { slug:'minimal-beige',    name:'MINIMAL BEIGE',    tag:'quiet luxury walls',              price:649, sale:0,   stock:36, cats:['minimal-aesthetic'], tags:['minimal','beige','calm','neutral'], featured:false, isNew:false, best:false },
  { slug:'dark-academia',    name:'DARK ACADEMIA',    tag:'romanticise everything',          price:699, sale:0,   stock:21, cats:['minimal-aesthetic'], tags:['dark academia','books','gothic','classic'], featured:false, isNew:true, best:false },
  { slug:'saturn-return',    name:'SATURN RETURN',    tag:'cosmic girl era',                 price:699, sale:599, stock:44, cats:['minimal-aesthetic','coquette-pink'], tags:['space','cosmic','saturn','purple'], featured:false, isNew:false, best:true },
  { slug:'retro-summer',     name:'RETRO SUMMER',     tag:'endless golden hour',             price:649, sale:0,   stock:30, cats:['minimal-aesthetic'], tags:['retro','summer','sunset','beach'], featured:false, isNew:true, best:false },
];

const CATS = [
  { id:'coquette-pink',   name:'Coquette & Pink',   desc:'Soft girl walls — pinks, ribbons and romance.', sort:1 },
  { id:'anime-gaming',    name:'Anime & Gaming',    desc:'Tokyo nights, Y2K dreams and main-character walls.', sort:2 },
  { id:'street-urban',    name:'Street & Urban',    desc:'Streetwear, grunge and football culture.', sort:3 },
  { id:'music-cinema',    name:'Music & Cinema',    desc:'Idols, hip-hop, indie and film for your walls.', sort:4 },
  { id:'minimal-aesthetic', name:'Minimal & Aesthetic', desc:'Calm, curated, gallery-grade walls.', sort:5 },
];

const now = Date.now(), DAY = 864e5;
const products = SETS.map((s, i) => {
  const id = 'p' + String(i+1).padStart(2,'0');
  const createdAt = now - (20-i)*2*DAY - i*36e5;
  return {
    id, slug: s.slug, setNo: String(i+1).padStart(2,'0'),
    name: s.name + ' — Poster Set',
    short: s.tag,
    description: `${s.name} is a curated 6-poster wall set from Highstreet Society. ${s.tag[0].toUpperCase()+s.tag.slice(1)}. Each design is printed on thick 3mm board in crisp A4 size — ready to hang, no frames needed. Mix, match and build your own gallery wall.`,
    price: s.price, salePrice: s.sale || null,
    stock: s.stock, sku: 'HSS-SET-' + String(i+1).padStart(2,'0'),
    categoryIds: s.cats, tags: s.tags,
    cover: `/images/products/${s.slug}/cover.jpg`,
    posters: [1,2,3,4,5,6].map(n => `/images/products/${s.slug}/p${n}.jpg`),
    featured: s.featured, isNew: s.isNew, bestseller: s.best,
    type:'poster', sizes:[], bundleItems:[], posterSize:'A4', boardThickness:'3mm',
    published: true, allowBackorder: false, sort: i+1,
    views: 40 + ((i*37)%180), sold: s.best ? 25+((i*13)%30) : (i*7)%18,
    seoTitle: '', seoDesc: '',
    createdAt, updatedAt: createdAt
  };
});

const adminSalt = crypto.randomBytes(16).toString('hex');
const db = {
  meta: { orderSeq: 1001, productSeq: 21, customerSeq: 1, designSeq: 1001 },
  settings: {
    brand: { name:'Highstreet Society', short:'HSS', tagline:'Born on the streets. Quality • Comfort • Culture', est:'2025' },
    contact: {
      mobile:'01879665602', whatsapp:'01879665602', email:'',
      instagram:'https://www.instagram.com/highstreetsoociety',
      facebook:'https://www.facebook.com/share/16BwcU1Xwgs/',
      address:'Dhaka, Bangladesh'
    },
    delivery: { inside:70, outside:130, insideLabel:'Inside Dhaka', outsideLabel:'Outside Dhaka', freeAbove:0 },
    payments: {
      cod:{ enabled:true },
      bkash:{ enabled:true, number:'01879665602', accountType:'Personal', instruction:'Send Money to the number above, then enter your Transaction ID (TrxID) below.' },
      nagad:{ enabled:true, number:'01879665602', accountType:'Personal', instruction:'Send Money to the number above, then enter your Transaction ID (TrxID) below.' }
    },
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    admin: { username:'hssadmin', salt: adminSalt, passHash: hash('admin123', adminSalt) },
    seo: { title:'Highstreet Society — A4 Poster Sets | Wall Decor in Bangladesh', description:'Premium A4 poster sets printed on 3mm board. 6 curated designs per set. Cash on Delivery available all over Bangladesh.' },
    announcement: 'DROP 01 LIVE • NATIONWIDE DELIVERY • COD AVAILABLE',
    lowStockAt: 5
  },
  categories: CATS.concat([
    { id:'clothing', name:'Clothing', desc:'Streetwear tees, hoodies and more', sort:90 },
    { id:'combos', name:'Combos & Bundles', desc:'Save more with curated bundles', sort:91 }
  ]).map(c => ({ id:c.id, slug:c.id, name:c.name, description:c.desc, image:'', sort:c.sort, visible:true, createdAt: now-30*DAY })),
  products,
  customers: [],
  sessions: {},
  designs: [],
  revoked: {},
  orders: [],
  reviews: [],
  carts: [],
  content: {
    'shipping': { title:'Shipping & Delivery', body:'We deliver to every district and thana in Bangladesh.\n\nInside Dhaka city: 1-2 working days.\nOutside Dhaka: 2-4 working days.\n\nDelivery charges are shown at checkout based on your selected district and thana. Cash on Delivery is available nationwide.', updatedAt: now },
    'returns': { title:'Returns & Refunds', body:'If your poster set arrives damaged or incorrect, contact us on WhatsApp within 48 hours of delivery with a photo of the parcel.\n\nWe will replace the set free of charge. Because posters are print products, we cannot accept change-of-mind returns once the seal is opened.', updatedAt: now },
    'privacy': { title:'Privacy Policy', body:'We collect only the information required to deliver your order: your name, mobile number and delivery address.\n\nWe never sell or share your data with third parties. Your mobile number is used only for order updates and delivery coordination.', updatedAt: now },
    'terms': { title:'Terms & Conditions', body:'All prices are in Bangladeshi Taka (BDT) and include VAT where applicable.\n\nOrders are confirmed once we verify your mobile number or payment. Manual bKash and Nagad payments require a valid Transaction ID, which we verify before shipping.\n\nColours may vary slightly between screen and print.', updatedAt: now },
    'faq': { title:'Frequently Asked Questions', body:'What is in a set?\nEvery set contains 6 different A4 posters printed on 3mm board.\n\nDo I need frames?\nNo. The 3mm board is rigid and ready to hang.\n\nHow do I pay?\nCash on Delivery, bKash or Nagad.\n\nDo you deliver outside Dhaka?\nYes, to every district in Bangladesh.', updatedAt: now }
  },
  coupons: [
    { code:'WELCOME10', type:'percent', value:10, minOrder:500, active:true, usage:0, createdAt: now-10*DAY },
    { code:'FLAT50', type:'flat', value:50, minOrder:600, active:true, usage:0, createdAt: now-10*DAY }
  ],
  homepage: {
    hero: { badge:'DROP 01 • LIVE NOW', line1:'WEAR THE', line2:'CULTURE.', line3:'LIVE', line3Italic:'the space.', title:'WEAR THE CULTURE. LIVE THE SPACE.', subtitle:'Contemporary pieces for the streets and your walls.', ctaText:'Shop the Collection', ctaLink:'/shop', cta2Text:'Explore Posters', cta2Link:'/shop?filter=new', image:'/images/hero-collage.png' },
    featuredIds:['p01','p07','p05','p10','p16'],
    newIds:['p03','p04','p06','p09','p12','p18','p20'],
    bestsellerIds:['p01','p02','p05','p08','p13','p19'],
    collectionCategoryIds:['coquette-pink','anime-gaming','street-urban','music-cinema'],
    perksTitle:'Why Highstreet Society',
    showSections:{ hero:true, marquee:true, new:true, best:true, featured:true, collections:true, perks:true, insta:true }
  }
};

fs.writeFileSync(path.join(__dirname,'data','db.json'), JSON.stringify(db, null, 2));
console.log('Seeded', products.length, 'products. Admin login: hssadmin / admin123');
