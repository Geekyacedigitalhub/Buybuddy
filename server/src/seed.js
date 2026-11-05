import 'dotenv/config';
import { db, migrate, reset } from './lib/db.js';
import { hashPassword } from './lib/auth.js';
import { ensureDefaults, walletEntry } from './lib/settings.js';
import { uid, now, orderCode, slugify, fakePin } from './lib/util.js';

/**
 * Seed = a realistic Lagos marketplace: 8 approved stores across the launch
 * categories, 70+ products, verified shoppers/riders, one live order at every
 * stage and 7 days of history so the dashboards are meaningful.
 *
 * Run: npm run seed
 */

/* Product imagery.
 * Real photography ships in web/public/img/products/ and is served from the same
 * origin, so it works identically on the web and inside the installed app.
 * Anything without a photo yet falls back to a designed tile (brand-tinted
 * gradient, large glyph, soft rings) — deliberately illustrated, not a broken
 * image. Swap in client photography by adding a file and a line to PHOTO below.
 */
const PHOTO = [
  // most specific first — "Jollof Rice & Fried Chicken" must hit jollof, not chicken
  [/jollof/i, 'jollof'],
  [/egusi|pepper soup/i, 'egusi'],
  [/eggs/i, 'eggs'],
  [/peak milk|milk powder/i, 'milk'],
  [/indomie|noodles/i, 'noodles'],
  [/tomato/i, 'tomatoes'],
  [/onion/i, 'tomatoes'],
  [/chicken/i, 'chicken'],
  [/spinach|ugu|leafy/i, 'vegetables'],
  [/bread/i, 'bread'],
  [/semovita|semolina|rice/i, 'rice'],
];

const photoFor = (name) => {
  const hit = PHOTO.find(([re]) => re.test(name));
  return hit ? `/img/products/${hit[1]}.jpg` : null;
};

const TILE_TONES = {
  'Groceries & Supermarket': ['#E7F1EC', '#D3E7DC'],
  'Food & Restaurants': ['#FBEDE3', '#F6DCC8'],
  'Fashion & Clothing': ['#F2EAF6', '#E3D5EE'],
  'Electronics & Gadgets': ['#E8EEF7', '#D6E1F0'],
  'Pharmacy & Health': ['#E6F3F4', '#CDE7E9'],
  'Beauty & Personal Care': ['#FBEAF0', '#F3D6E2'],
  'Home & Household': ['#F0F0EA', '#E1E1D6'],
  'Drinks & Beverages': ['#EAF2FA', '#D5E7F6'],
  'Baby Products': ['#FDF2E4', '#F7E2C6'],
  'Shop For Me': ['#E9F3EF', '#D5E8DF'],
};

const tile = (emoji, category = 'Groceries & Supermarket') => {
  const [c1, c2] = TILE_TONES[category] || TILE_TONES['Groceries & Supermarket'];
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="520" viewBox="0 0 520 520">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
          </linearGradient>
          <radialGradient id="s" cx="0.5" cy="0.35" r="0.65">
            <stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/>
            <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="520" height="520" fill="url(#g)"/>
        <circle cx="410" cy="96" r="120" fill="#ffffff" opacity="0.20"/>
        <circle cx="92" cy="452" r="96" fill="#ffffff" opacity="0.16"/>
        <rect width="520" height="520" fill="url(#s)"/>
        <text x="260" y="312" font-size="196" text-anchor="middle"
              font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${emoji}</text>
      </svg>`
    )
  );
};

const img = (emoji, category) => tile(emoji, category);

/* Home hero art: a photo when we have one, otherwise a rich brand gradient. */
const BANNER_PHOTOS = ['/img/products/jollof.jpg', '/img/products/tomatoes.jpg', '/img/products/eggs.jpg'];
const bannerArt = (i) => BANNER_PHOTOS[i % BANNER_PHOTOS.length];

const daysAgo = (n, hour = 12) => {
  const d = new Date(Date.now() - n * 864e5);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
};

const CATEGORIES = [
  { name: 'Groceries & Supermarket', icon: '🛒', sort: 1 },
  { name: 'Food & Restaurants', icon: '🍲', sort: 2 },
  { name: 'Fashion & Clothing', icon: '👗', sort: 3 },
  { name: 'Electronics & Gadgets', icon: '📱', sort: 4 },
  { name: 'Pharmacy & Health', icon: '💊', sort: 5 },
  { name: 'Beauty & Personal Care', icon: '💅', sort: 6 },
  { name: 'Home & Household', icon: '🏠', sort: 7 },
  { name: 'Drinks & Beverages', icon: '🥤', sort: 8 },
  { name: 'Baby Products', icon: '🍼', sort: 9 },
  { name: 'Shop For Me', icon: '🛍️', sort: 10 },
];

const STORES = [
  {
    name: 'GreenMart Supermarket',
    cat: 'Groceries & Supermarket',
    area: 'Lekki Phase 1',
    emoji: '🛒',
    rating: 4.7,
    products: [
      ['Golden Penny Semovita 1kg', 1850, 2100, '🟡', 'Groceries & Supermarket'],
      ['Peak Milk Powder 380g', 3450, null, '🥛', 'Groceries & Supermarket'],
      ['Indomie Instant Noodles (Pack of 10)', 3800, 4200, '🍜', 'Groceries & Supermarket'],
      ['Dangote Sugar 500g', 950, null, '🧂', 'Groceries & Supermarket'],
      ['Mama Gold Rice 5kg', 9800, 10500, '🍚', 'Groceries & Supermarket'],
      ['Devon King\'s Vegetable Oil 1L', 2900, null, '🫗', 'Groceries & Supermarket'],
      ['Farm Fresh Eggs (Crate of 30)', 4200, 4600, '🥚', 'Groceries & Supermarket'],
      ['Tomatoes (1kg basket)', 1600, null, '🍅', 'Groceries & Supermarket'],
      ['Onions (1kg)', 1400, null, '🧅', 'Groceries & Supermarket'],
      ['Fresh Chicken (Whole, 1.5kg)', 6800, 7500, '🍗', 'Groceries & Supermarket'],
    ],
  },
  {
    name: 'Mama Cass Kitchen',
    cat: 'Food & Restaurants',
    area: 'Yaba',
    emoji: '🍲',
    rating: 4.8,
    products: [
      ['Jollof Rice & Fried Chicken', 3800, null, '🍛', 'Food & Restaurants'],
      ['Egusi Soup with Pounded Yam', 4200, null, '🍲', 'Food & Restaurants'],
      ['Pepper Soup (Catfish)', 4500, 5000, '🐟', 'Food & Restaurants'],
      ['Small Chops Platter', 3200, null, '🥟', 'Food & Restaurants'],
      ['Beef Suya Wrap', 2800, null, '🥩', 'Food & Restaurants'],
      ['Ofada Rice & Ayamase', 4000, null, '🍚', 'Food & Restaurants'],
      ['Chapman (1 Litre)', 2000, 2500, '🍹', 'Drinks & Beverages'],
    ],
  },
  {
    name: 'Fresh Basket Groceries',
    cat: 'Groceries & Supermarket',
    area: 'Ikoyi',
    emoji: '🥑',
    rating: 4.5,
    products: [
      ['Avocado (Pack of 3)', 2500, null, '🥑', 'Groceries & Supermarket'],
      ['Organic Spinach Bunch', 1200, null, '🥬', 'Groceries & Supermarket'],
      ['Sweet Corn (4 cobs)', 1800, null, '🌽', 'Groceries & Supermarket'],
      ['Greek Yoghurt 500ml', 3200, 3600, '🥣', 'Groceries & Supermarket'],
      ['Whole Wheat Bread', 1600, null, '🍞', 'Groceries & Supermarket'],
      ['Honey (Pure, 500g)', 5500, null, '🍯', 'Groceries & Supermarket'],
    ],
  },
  {
    name: 'TechHub Electronics',
    cat: 'Electronics & Gadgets',
    area: 'Ikeja',
    emoji: '📱',
    rating: 4.4,
    products: [
      ['Anker PowerCore 20,000mAh', 28500, 32000, '🔋', 'Electronics & Gadgets'],
      ['Oraimo FreePods 4', 18500, 22000, '🎧', 'Electronics & Gadgets'],
      ['Samsung Galaxy A15 128GB', 245000, 265000, '📱', 'Electronics & Gadgets'],
      ['USB-C Fast Charger 65W', 12000, null, '🔌', 'Electronics & Gadgets'],
      ['HP Wireless Mouse', 8500, 10000, '🖱️', 'Electronics & Gadgets'],
      ['Bluetooth Speaker (Waterproof)', 22000, null, '🔊', 'Electronics & Gadgets'],
      ['Smart LED Bulb (WiFi)', 9500, null, '💡', 'Home & Household'],
    ],
  },
  {
    name: 'Ada Fashion House',
    cat: 'Fashion & Clothing',
    area: 'Surulere',
    emoji: '👗',
    rating: 4.6,
    products: [
      ['Ankara Print Dress', 22000, 26000, '👗', 'Fashion & Clothing'],
      ['Men\'s Kaftan (Senator)', 35000, null, '🧥', 'Fashion & Clothing'],
      ['Sneakers (Unisex)', 28000, 32000, '👟', 'Fashion & Clothing'],
      ['Leather Handbag', 42000, null, '👜', 'Fashion & Clothing'],
      ['Aso Oke Head Tie', 8500, null, '🧣', 'Fashion & Clothing'],
      ['Designer Sunglasses', 15000, 18500, '🕶️', 'Fashion & Clothing'],
    ],
  },
  {
    name: 'HealthPlus Pharmacy',
    cat: 'Pharmacy & Health',
    area: 'Victoria Island',
    emoji: '💊',
    rating: 4.9,
    products: [
      ['Paracetamol 500mg (Pack of 20)', 1200, null, '💊', 'Pharmacy & Health'],
      ['Vitamin C 1000mg (60 tablets)', 4500, 5200, '🍊', 'Pharmacy & Health'],
      ['Digital Thermometer', 6500, null, '🌡️', 'Pharmacy & Health'],
      ['First Aid Kit (Home)', 12000, 14500, '🩹', 'Pharmacy & Health'],
      ['Hand Sanitiser 500ml', 2200, null, '🧴', 'Pharmacy & Health'],
      ['Blood Pressure Monitor', 38000, null, '🩺', 'Pharmacy & Health'],
    ],
  },
  {
    name: 'Glow Beauty Studio',
    cat: 'Beauty & Personal Care',
    area: 'Lekki Phase 1',
    emoji: '💅',
    rating: 4.5,
    products: [
      ['Shea Butter Body Cream 250ml', 4800, null, '🧴', 'Beauty & Personal Care'],
      ['Matte Lipstick Set (5 shades)', 9500, 11000, '💄', 'Beauty & Personal Care'],
      ['Argan Hair Oil 100ml', 6200, null, '🧖', 'Beauty & Personal Care'],
      ['Facial Cleanser (Gentle)', 7500, null, '🧼', 'Beauty & Personal Care'],
      ['Perfume Gift Set', 28000, 34000, '🌸', 'Beauty & Personal Care'],
    ],
  },
  {
    name: 'Home Essentials NG',
    cat: 'Home & Household',
    area: 'Ajah',
    emoji: '🏠',
    rating: 4.3,
    products: [
      ['Non-stick Frying Pan 28cm', 14000, 16500, '🍳', 'Home & Household'],
      ['Bed Sheet Set (Queen)', 21000, null, '🛏️', 'Home & Household'],
      ['Ariel Detergent 1kg', 3200, null, '🧺', 'Home & Household'],
      ['Stainless Cutlery Set (24pcs)', 18500, 22000, '🍴', 'Home & Household'],
      ['Electric Kettle 1.8L', 16500, null, '🫖', 'Home & Household'],
      ['Rechargeable Standing Fan', 42000, 48000, '🌀', 'Home & Household'],
    ],
  },
  {
    name: 'BabyCare Corner',
    cat: 'Baby Products',
    area: 'Gbagada',
    emoji: '🍼',
    rating: 4.7,
    products: [
      ['Pampers Baby Dry (M, 48pcs)', 12500, 14000, '🧷', 'Baby Products'],
      ['Baby Formula Stage 2 400g', 9800, null, '🍼', 'Baby Products'],
      ['Baby Wipes (Pack of 4)', 4500, null, '🧻', 'Baby Products'],
      ['Cotton Baby Onesie (3 pack)', 8500, 10000, '👶', 'Baby Products'],
      ['Baby Bath Set', 11000, null, '🛁', 'Baby Products'],
    ],
  },
  {
    name: 'ChillPoint Drinks',
    cat: 'Drinks & Beverages',
    area: 'Yaba',
    emoji: '🥤',
    rating: 4.4,
    products: [
      ['Coca-Cola Crate (12 x 50cl)', 6800, 7400, '🥤', 'Drinks & Beverages'],
      ['Bottled Water Pack (12 x 75cl)', 2800, null, '💧', 'Drinks & Beverages'],
      ['Malt Drink (Pack of 6)', 4200, null, '🍺', 'Drinks & Beverages'],
      ['Fresh Orange Juice 1L', 3500, 4000, '🍊', 'Drinks & Beverages'],
      ['Red Wine (Cabernet 75cl)', 14500, null, '🍷', 'Drinks & Beverages'],
    ],
  },
];

export async function main({ reset: resetDb = true } = {}) {
  const shouldReset = process.argv.includes('--reset');
  if (shouldReset) reset();
  else migrate();
  ensureDefaults();

  const existing = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (existing > 0 && !shouldReset) {
    console.log('Database already seeded. Use "npm run seed" (which passes --reset) to rebuild.');
    return;
  }

  /* ------------------------------- users -------------------------------- */
  const password = hashPassword('Password123!');
  const mkUser = (role, name, email, phone, extra = {}) => {
    const id = uid('usr');
    db.prepare(
      `INSERT INTO users (id,role,name,email,phone,password_hash,status,avatar,city,area,phone_verified,email_verified,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, role, name, email, phone, password, extra.status || 'active', extra.avatar || null,
      'Lagos', extra.area || 'Lekki Phase 1', 1, 1, extra.created_at || daysAgo(30)
    );
    return id;
  };

  const adminId = mkUser('admin', 'Amaka Obi (Admin)', 'admin@buybuddy.ng', '+2348030000001', { area: 'Ikoyi' });
  const customerId = mkUser('customer', 'Tunde Bakare', 'customer@buybuddy.ng', '+2348030000002');
  const customer2 = mkUser('customer', 'Zainab Yusuf', 'zainab@buybuddy.ng', '+2348030000003', { area: 'Yaba' });
  const customer3 = mkUser('customer', 'Emeka Nwosu', 'emeka@buybuddy.ng', '+2348030000004', { area: 'Ikeja' });

  /* merchants + stores */
  const merchantIds = {};
  const storeIds = {};
  let storeIdx = 0;
  for (const s of STORES) {
    const email = `merchant${storeIdx + 1}@buybuddy.ng`;
    const mid = mkUser('merchant', `${s.name} Owner`, email, `+23480300001${String(storeIdx).padStart(2, '0')}`, {
      area: s.area,
      created_at: daysAgo(60 - storeIdx),
    });
    merchantIds[s.name] = mid;
    db.prepare(
      'INSERT INTO merchant_profiles (user_id,business_name,cac_number,business_address,verified,bank_name,account_number,account_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(mid, `${s.name} Ltd`, `RC${100000 + storeIdx}`, `${s.area}, Lagos`, 1, 'GTBank', `01234567${storeIdx}`, s.name, daysAgo(60 - storeIdx));

    const sid = uid('str');
    storeIds[s.name] = sid;
    db.prepare(
      `INSERT INTO stores (id,merchant_id,name,slug,description,logo,cover,area,city,phone,status,is_open,rating_avg,rating_count,
        commission_rate,opens_at,closes_at,prep_minutes,min_order,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      sid, mid, s.name, `${slugify(s.name)}-${storeIdx}`, `${s.name} — ${s.cat} delivered across Lagos in minutes.`,
      img(s.emoji, s.cat), img(s.emoji, s.cat), s.area, 'Lagos', '+2348030000000', 'active', 1,
      s.rating, 40 + storeIdx * 7, 0.12, '08:00', '22:00', 15 + storeIdx, 1000 + storeIdx * 500, daysAgo(60 - storeIdx)
    );
    storeIdx += 1;
  }

  /* one pending merchant, so admin has something to approve */
  const pendingMerchant = mkUser('merchant', 'Bola Adeyemi', 'pending.merchant@buybuddy.ng', '+2348030000900', {
    status: 'pending', area: 'Surulere', created_at: daysAgo(2),
  });
  db.prepare('INSERT INTO merchant_profiles (user_id,business_name,cac_number,business_address,verified,created_at) VALUES (?,?,?,?,?,?)').run(
    pendingMerchant, 'Bola\'s Bakery', 'RC999001', '12 Adeniran Ogunsanya, Surulere', 0, daysAgo(2)
  );
  db.prepare(
    `INSERT INTO stores (id,merchant_id,name,slug,description,logo,area,city,status,is_open,commission_rate,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(uid('str'), pendingMerchant, 'Bola\'s Bakery', 'bolas-bakery-pending', 'Fresh bread and pastries, Surulere.', img('🥐'), 'Surulere', 'Lagos', 'pending', 0, 0.12, daysAgo(2));

  /* workers */
  const mkWorker = (name, email, phone, roles, areas, verified = 1, extra = {}) => {
    const id = mkUser(roles === 'rider' ? 'rider' : 'shopper', name, email, phone, {
      status: verified ? 'active' : 'pending', area: areas, created_at: extra.created_at || daysAgo(45),
      ...extra,
    });
    db.prepare(
      `INSERT INTO worker_profiles (user_id,roles,vehicle,plate,service_city,service_areas,docs_json,verified,rating_avg,rating_count,
        commission_rate,available,bank_name,bank_code,account_name,account_number,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, roles, roles === 'rider' ? 'Bike' : null, roles === 'rider' ? extra.plate || 'LAG-123-XY' : null,
      'Lagos', areas, JSON.stringify({ id_card: true, selfie: true, guarantor: true }), verified,
      extra.rating || 4.8, extra.count || 62, 0.15, 1, 'GTBank', '058', name, `012345678${Math.floor(Math.random() * 9)}`,
      extra.created_at || daysAgo(45)
    );
    return id;
  };

  const shopper1 = mkWorker('Chinedu Okoro', 'shopper@buybuddy.ng', '+2348030000010', 'shopper', 'Lekki Phase 1, Ikoyi, Victoria Island', 1, { rating: 4.9, count: 84 });
  const shopper2 = mkWorker('Halima Sule', 'halima@buybuddy.ng', '+2348030000011', 'shopper', 'Yaba, Surulere, Gbagada', 1, { rating: 4.7, count: 51 });
  const shopper3 = mkWorker('Grace Peters', 'grace@buybuddy.ng', '+2348030000012', 'shopper', 'Ikeja, Agege, Ogba', 1, { rating: 4.6, count: 33 });
  const pendingWorker = mkWorker('Femi Ade', 'pending.worker@buybuddy.ng', '+2348030000013', 'shopper', 'Ajah, Sangotedo', 0, { rating: 0, count: 0 });
  const rider1 = mkWorker('Sani Musa', 'rider@buybuddy.ng', '+2348030000020', 'rider', 'Lagos Island, Lekki, Ikoyi', 1, { rating: 4.8, count: 120, plate: 'LAG-482-KJA' });
  const rider2 = mkWorker('Kelechi Nnamdi', 'rider2@buybuddy.ng', '+2348030000021', 'rider', 'Yaba, Surulere, Ikeja', 1, { rating: 4.7, count: 96, plate: 'LAG-731-BCD' });
  const rider3 = mkWorker('Ifeanyi Eze', 'rider3@buybuddy.ng', '+2348030000022', 'rider', 'Ajagun, Ajah, Lekki', 1, { rating: 4.9, count: 143, plate: 'LAG-229-TTE' });

  /* addresses */
  const mkAddress = (userId, label, line1, area, isDefault = 1) => {
    const id = uid('adr');
    db.prepare(
      'INSERT INTO addresses (id,user_id,label,recipient,phone,line1,area,city,lat,lng,notes,is_default,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id, userId, label, null, null, line1, area, 'Lagos', 6.4474, 3.4736,
      'Near the blue gate, call on arrival', isDefault, daysAgo(20)
    );
    return id;
  };
  const addr1 = mkAddress(customerId, 'Home', '14 Admiralty Way, Lekki Phase 1', 'Lekki Phase 1');
  const addr1b = mkAddress(customerId, 'Office', '1 Adeola Odeku Street, Victoria Island', 'Victoria Island', 0);
  const addr2 = mkAddress(customer2, 'Home', '22 Herbert Macaulay Way, Yaba', 'Yaba');
  const addr3 = mkAddress(customer3, 'Home', '9 Allen Avenue, Ikeja', 'Ikeja');

  /* categories */
  const catIds = {};
  for (const c of CATEGORIES) {
    const id = uid('cat');
    catIds[c.name] = id;
    db.prepare('INSERT INTO categories (id,name,slug,icon,parent_id,sort,active) VALUES (?,?,?,?,?,?,?)').run(
      id, c.name, slugify(c.name), c.icon, null, c.sort, 1
    );
  }

  /* products */
  const productIds = [];
  for (const s of STORES) {
    for (const [name, price, compare, emoji, cat] of s.products) {
      const id = uid('prd');
      productIds.push({ id, name, price, store: s.name });
      db.prepare(
        `INSERT INTO products (id,store_id,category_id,name,description,price,compare_at,image,unit,stock,status,tags,rating_avg,rating_count,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id, storeIds[s.name], catIds[cat], name,
        `${name} — sourced fresh and delivered by your BUYBUDDY shopper. Quality checked before dispatch.`,
        price, compare, photoFor(name) || img(emoji, cat), 'each', 40 + Math.floor(Math.random() * 80), 'active',
        `${s.cat}, ${name.split(' ')[0]}`.toLowerCase(), 4 + Math.random(), 5 + Math.floor(Math.random() * 60),
        daysAgo(20 + Math.random() * 20)
      );
    }
  }
  const productByName = Object.fromEntries(productIds.map((p) => [p.name, p]));

  /* promos */
  const promos = [
    ['WELCOME10', 'percent', 10, 3000, 2000, 1000, '10% off your first order (max ₦2,000)'],
    ['FREEDEL', 'free_delivery', 0, 5000, null, 300, 'Free delivery on orders above ₦5,000'],
    ['NAIRA500', 'fixed', 500, 4000, null, 500, '₦500 off orders above ₦4,000'],
  ];
  for (const [code, type, value, min, maxDisc, limit, desc] of promos) {
    db.prepare(
      `INSERT INTO promos (code,description,type,value,min_subtotal,max_discount,usage_limit,used_count,active,expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(code, desc, type, value, min, maxDisc, limit, Math.floor(Math.random() * 40), 1, daysAgo(-30), daysAgo(14));
  }

  /* banners */
  const banners = [
    ['Anything you need, delivered', 'Groceries, food, fashion, pharmacy — in one app.', '#176B55', '🛍️'],
    ['Shop for me', 'Send a photo or a list. A buddy buys it for you.', '#1E8266', '📸'],
    ['Free delivery over ₦5,000', 'Use code FREEDEL at checkout.', '#B4562A', '🚀'],
  ];
  banners.forEach(([title, subtitle, color, emoji], i) => {
    db.prepare(
      'INSERT INTO marketing_banners (id,title,subtitle,image,cta_label,cta_link,bg_color,active,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(uid('bnr'), title, subtitle, bannerArt(i), 'Shop now', '/', color, 1, i, daysAgo(10));
  });

  /* ------------------------------- orders ------------------------------- */
  const createOrder = ({
    customer, store, items, status, paymentStatus = 'paid', type = 'merchant', address = addr1,
    shopper = null, rider = null, createdAt = daysAgo(1), serviceLevel = 'standard', shoppingItems = null,
    approvedSubtotal = null,
  }) => {
    const id = uid('ord');
    const subtotal = items
      ? items.reduce((s, [name, qty]) => s + (productByName[name]?.price || 0) * qty, 0)
      : (shoppingItems || []).reduce((s2, i) => s2 + (i.target_price || i.proposed_price || 0) * (i.qty || 1), 0);
    const serviceFee = type === 'personal' ? Math.round(subtotal * 0.08) + 300 : Math.round(subtotal * 0.05) + 150;
    const deliveryFee = 700 + 120 * 4.2;
    const tax = Math.round((serviceFee + deliveryFee) * 0.075);
    const total = subtotal + serviceFee + deliveryFee + tax;
    db.prepare(
      `INSERT INTO orders (id,code,customer_id,type,store_id,status,subtotal,service_fee,delivery_fee,tax,discount,total,currency,
        payment_method,payment_status,address_json,instructions,budget,service_level,shopper_id,rider_id,delivery_pin,
        approved_subtotal,distance_km,created_at,updated_at,completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, orderCode(), customer, type, store || null, status, subtotal, serviceFee, deliveryFee, tax, 0, total, 'NGN',
      'paystack', paymentStatus,
      JSON.stringify({ label: 'Home', line1: '14 Admiralty Way', area: 'Lekki Phase 1', city: 'Lagos', recipient: 'Tunde Bakare', phone: '+2348030000002', lat: 6.4474, lng: 3.4736 }),
      null, type === 'personal' ? subtotal * 1.2 : null, serviceLevel, shopper, rider, fakePin(),
      approvedSubtotal, 4.2, createdAt, createdAt,
      ['completed', 'delivered'].includes(status) ? createdAt : null
    );
    if (items) {
      for (const [name, qty] of items) {
        const p = productByName[name];
        db.prepare('INSERT INTO order_items (id,order_id,product_id,name,price,qty,image,status) VALUES (?,?,?,?,?,?,?,?)').run(
          uid('oit'), id, p?.id || null, name, p?.price || 0, qty, img('🛍️'), 'active'
        );
      }
    }
    if (shoppingItems) {
      for (const it of shoppingItems) {
        db.prepare(
          `INSERT INTO shopping_items (id,order_id,description,qty,target_price,proposed_name,proposed_price,proposed_qty,image,status,note,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(uid('sit'), id, it.description, it.qty || 1, it.target_price || null, it.proposed_name || null,
          it.proposed_price || null, it.proposed_qty || null, img(it.emoji || '🛍️'), it.status || 'requested',
          it.note || null, createdAt);
      }
    }
    db.prepare('INSERT INTO order_events (id,order_id,actor_id,actor_role,type,message,created_at) VALUES (?,?,?,?,?,?,?)').run(
      uid('evt'), id, customer, 'customer', 'created', 'Order placed', createdAt
    );
    if (paymentStatus === 'paid') {
      db.prepare('INSERT INTO payments (id,order_id,provider,reference,amount,status,method,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        uid('pay'), id, 'paystack', `seed_${id}`, total, 'success', 'card', createdAt, createdAt
      );
    }
    return id;
  };

  /* history: completed orders across stores (drives GMV + merchant dashboards) */
  const history = [
    { customer: customerId, store: 'GreenMart Supermarket', items: [["Mama Gold Rice 5kg", 1], ["Peak Milk Powder 380g", 2]], days: 6, status: 'completed', rider: rider1, shopper: null },
    { customer: customer2, store: 'Mama Cass Kitchen', items: [["Jollof Rice & Fried Chicken", 2], ["Chapman (1 Litre)", 1]], days: 5, status: 'completed', rider: rider2 },
    { customer: customer3, store: 'TechHub Electronics', items: [["Anker PowerCore 20,000mAh", 1]], days: 4, status: 'completed', rider: rider3 },
    { customer: customerId, store: 'HealthPlus Pharmacy', items: [["Vitamin C 1000mg (60 tablets)", 1], ["Digital Thermometer", 1]], days: 3, status: 'completed', rider: rider1 },
    { customer: customer2, store: 'Glow Beauty Studio', items: [["Shea Butter Body Cream 250ml", 2]], days: 2, status: 'completed', rider: rider2 },
    { customer: customer3, store: 'ChillPoint Drinks', items: [["Coca-Cola Crate (12 x 50cl)", 2], ["Bottled Water Pack (12 x 75cl)", 1]], days: 1, status: 'delivered', rider: rider3 },
    { customer: customerId, store: 'Fresh Basket Groceries', items: [["Avocado (Pack of 3)", 1], ["Whole Wheat Bread", 2]], days: 0, status: 'in_transit', rider: rider1 },
  ];
  for (const h of history) {
    createOrder({
      customer: h.customer,
      store: storeIds[h.store],
      items: h.items,
      status: h.status,
      rider: h.rider || null,
      createdAt: daysAgo(h.days, 9 + h.days),
    });
  }

  /* one order waiting for merchant acceptance */
  createOrder({
    customer: customerId,
    store: storeIds['GreenMart Supermarket'],
    items: [["Farm Fresh Eggs (Crate of 30)", 1], ["Devon King's Vegetable Oil 1L", 1]],
    status: 'paid',
    createdAt: daysAgo(0, 8),
  });

  /* one live personal-shopping request awaiting approval */
  const liveId = createOrder({
    customer: customerId,
    store: null,
    type: 'personal',
    status: 'awaiting_approval',
    shopper: shopper1,
    items: null,
    subtotal: 0,
    approvedSubtotal: 0,
    createdAt: daysAgo(0, 10),
    shoppingItems: [
      { description: 'Cerelac baby cereal, 400g tin', qty: 2, target_price: 3200, proposed_name: 'Nestlé Cerelac Wheat 400g', proposed_price: 3450, proposed_qty: 2, status: 'proposed', emoji: '🍚' },
      { description: 'Pampers size 3, medium pack', qty: 1, target_price: 8000, proposed_name: 'Pampers Baby Dry M (48pcs)', proposed_price: 12500, proposed_qty: 1, status: 'proposed', emoji: '🧷', note: 'Only the 48-piece pack was available' },
      { description: 'Fresh strawberries', qty: 1, target_price: 4000, status: 'unavailable', emoji: '🍓', note: 'Not available at the store today' },
    ],
  });

  /* one open shopping request with no shopper yet */
  createOrder({
    customer: customer2,
    store: null,
    type: 'personal',
    status: 'open_for_shoppers',
    items: null,
    subtotal: 9000,
    createdAt: daysAgo(0, 11),
    shoppingItems: [
      { description: 'Birthday cake, chocolate, 8 inch', qty: 1, target_price: 18000, emoji: '🎂' },
      { description: 'Party balloons (pack)', qty: 2, target_price: 2500, emoji: '🎈' },
    ],
  });

  /* one order ready for rider pickup, so the rider app has an offer */
  createOrder({
    customer: customer3,
    store: storeIds['Mama Cass Kitchen'],
    items: [["Egusi Soup with Pounded Yam", 1], ["Small Chops Platter", 1]],
    status: 'ready_for_pickup',
    createdAt: daysAgo(0, 12),
  });

  /* job offers for the two open jobs */
  const openOrders = db.prepare("SELECT * FROM orders WHERE status IN ('open_for_shoppers','ready_for_pickup')").all();
  for (const o of openOrders) {
    const role = o.status === 'open_for_shoppers' ? 'shopper' : 'rider';
    const workers = role === 'shopper' ? [shopper1, shopper2, shopper3] : [rider1, rider2, rider3];
    for (const w of workers) {
      db.prepare('INSERT OR IGNORE INTO job_offers (id,order_id,worker_id,role,status,created_at) VALUES (?,?,?,?,?,?)').run(
        uid('job'), o.id, w, role, 'offered', now()
      );
    }
  }

  /* wallet balances so earnings screens are non-empty */
  walletEntry(rider1, { type: 'credit', amount: 18400, description: 'Delivery earnings — last week' });
  walletEntry(rider2, { type: 'credit', amount: 12250, description: 'Delivery earnings — last week' });
  walletEntry(rider3, { type: 'credit', amount: 21700, description: 'Delivery earnings — last week' });
  walletEntry(shopper1, { type: 'credit', amount: 24800, description: 'Shopper earnings — last week' });
  walletEntry(shopper2, { type: 'credit', amount: 15600, description: 'Shopper earnings — last week' });
  walletEntry(merchantIds['GreenMart Supermarket'], { type: 'credit', amount: 48600, description: 'Settlement — last week' });
  walletEntry(merchantIds['Mama Cass Kitchen'], { type: 'credit', amount: 31200, description: 'Settlement — last week' });
  walletEntry(customerId, { type: 'credit', amount: 15000, description: 'Wallet top-up (sandbox)' });

  /* reviews */
  const completedOrders = db.prepare("SELECT * FROM orders WHERE status IN ('completed','delivered')").all();
  const comments = [
    'Very fast, and everything arrived in perfect condition.',
    'My shopper found exactly what I needed. Impressive!',
    'Great service — the rider called before arriving.',
    'Good value. Will order again.',
  ];
  completedOrders.forEach((o, i) => {
    if (o.store_id) {
      db.prepare('INSERT INTO reviews (id,order_id,customer_id,target_type,target_id,rating,comment,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        uid('rev'), o.id, o.customer_id, 'store', o.store_id, 5 - (i % 2), comments[i % comments.length], 'published', o.created_at
      );
    }
    if (o.rider_id) {
      db.prepare('INSERT INTO reviews (id,order_id,customer_id,target_type,target_id,rating,comment,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        uid('rev'), o.id, o.customer_id, 'rider', o.rider_id, 5, comments[(i + 2) % comments.length], 'published', o.created_at
      );
    }
  });

  /* support ticket */
  const ticketId = uid('tkt');
  db.prepare(
    'INSERT INTO support_tickets (id,order_id,customer_id,subject,category,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(ticketId, liveId, customerId, 'Item price is higher than I expected', 'order', 'high', 'open', daysAgo(0, 11), daysAgo(0, 11));
  db.prepare('INSERT INTO support_messages (id,ticket_id,sender_id,sender_role,body,created_at) VALUES (?,?,?,?,?,?)').run(
    uid('msg'), ticketId, customerId, 'customer', 'The Pampers price went up by ₦4,500. Can you confirm this is correct?', daysAgo(0, 11)
  );

  /* notifications */
  const notifyRow = (userId, title, body, kind) =>
    db.prepare('INSERT INTO notifications (id,user_id,title,body,kind,read,created_at) VALUES (?,?,?,?,?,?,?)').run(
      uid('ntf'), userId, title, body, kind, 0, daysAgo(0, 10)
    );
  notifyRow(customerId, 'Order out for delivery 🛵', 'Sani is 6 minutes away with your groceries.', 'order');
  notifyRow(customerId, 'Approve your shopping basket', 'Your shopper proposed 3 items. Review and approve.', 'action');
  notifyRow(shopper1, 'New shopping request nearby', 'A customer in Lekki needs a personal shopper.', 'offer');

  /* payout request */
  db.prepare('INSERT INTO payouts (id,worker_id,amount,status,note,requested_at) VALUES (?,?,?,?,?,?)').run(
    uid('po'), rider1, 8000, 'requested', 'Weekly withdrawal', daysAgo(0, 9)
  );

  /* audit trail samples */
  db.prepare('INSERT INTO audit_logs (id,actor_id,actor_email,action,entity,entity_id,meta,ip,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    uid('aud'), adminId, 'admin@buybuddy.ng', 'merchant.approve', 'store', Object.values(storeIds)[0], JSON.stringify({ note: 'Documents verified' }), '127.0.0.1', daysAgo(3)
  );

  const counts = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    stores: db.prepare('SELECT COUNT(*) c FROM stores').get().c,
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
  };
  console.log('BUYBUDDY seed complete:', counts);
  console.log(`
Demo accounts (password: Password123!)
  admin@buybuddy.ng        → Admin dashboard
  customer@buybuddy.ng     → Customer app
  shopper@buybuddy.ng      → Shopper app (verified)
  rider@buybuddy.ng        → Rider app (verified)
  merchant1@buybuddy.ng    → Merchant portal (GreenMart)
  pending.merchant@buybuddy.ng → awaiting approval
  pending.worker@buybuddy.ng   → awaiting verification
`);
}

// Only auto-run when executed directly (`npm run seed`), never when imported.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
