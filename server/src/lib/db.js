import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'buybuddy.sqlite');
export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schema is applied idempotently on boot (CREATE IF NOT EXISTS) so a fresh
 * clone boots with zero manual steps. In production this file is the single
 * source of truth for the migration history; see docs/ARCHITECTURE.md.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','shopper','rider','merchant','admin')),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended','restricted')),
  avatar TEXT,
  city TEXT DEFAULT 'Lagos',
  area TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL, code TEXT NOT NULL, purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, recipient TEXT, phone TEXT,
  line1 TEXT NOT NULL, area TEXT, city TEXT NOT NULL DEFAULT 'Lagos',
  lat REAL, lng REAL, notes TEXT, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

CREATE TABLE IF NOT EXISTS worker_profiles (
  user_id TEXT PRIMARY KEY, roles TEXT NOT NULL DEFAULT 'shopper', vehicle TEXT, plate TEXT,
  service_city TEXT DEFAULT 'Lagos', service_areas TEXT, docs_json TEXT, verified INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 0.15, available INTEGER NOT NULL DEFAULT 1,
  bank_name TEXT, bank_code TEXT, account_name TEXT, account_number TEXT,
  rejection_reason TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_profiles (
  user_id TEXT PRIMARY KEY, business_name TEXT NOT NULL, cac_number TEXT, business_address TEXT,
  docs_json TEXT, verified INTEGER NOT NULL DEFAULT 0, rejection_reason TEXT,
  bank_name TEXT, bank_code TEXT, account_name TEXT, account_number TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, icon TEXT,
  parent_id TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  description TEXT, logo TEXT, cover TEXT, area TEXT, city TEXT DEFAULT 'Lagos', phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  is_open INTEGER NOT NULL DEFAULT 1, rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  commission_rate REAL NOT NULL DEFAULT 0.12, opens_at TEXT DEFAULT '08:00', closes_at TEXT DEFAULT '21:00',
  prep_minutes INTEGER NOT NULL DEFAULT 20, min_order INTEGER NOT NULL DEFAULT 0,
  suspended_reason TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stores_merchant ON stores(merchant_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, category_id TEXT, name TEXT NOT NULL,
  description TEXT, price INTEGER NOT NULL, compare_at INTEGER, image TEXT, unit TEXT,
  stock INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  tags TEXT, rating_avg REAL NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS favourites (
  user_id TEXT NOT NULL, product_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS promos (
  code TEXT PRIMARY KEY, description TEXT, type TEXT NOT NULL CHECK (type IN ('percent','fixed','free_delivery')),
  value INTEGER NOT NULL DEFAULT 0, min_subtotal INTEGER NOT NULL DEFAULT 0, max_discount INTEGER,
  usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, customer_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('merchant','personal')),
  store_id TEXT, status TEXT NOT NULL, subtotal INTEGER NOT NULL DEFAULT 0,
  service_fee INTEGER NOT NULL DEFAULT 0, delivery_fee INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN', payment_method TEXT NOT NULL DEFAULT 'paystack',
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded','paid_cash')),
  promo_code TEXT, address_json TEXT, notes TEXT, instructions TEXT,
  budget INTEGER, service_level TEXT DEFAULT 'standard', scheduled_for TEXT,
  shopper_id TEXT, rider_id TEXT, delivery_pin TEXT, idempotency_key TEXT UNIQUE,
  cancel_reason TEXT, approved_subtotal INTEGER, distance_km REAL DEFAULT 3.5,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_shopper ON orders(shopper_id);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT, name TEXT NOT NULL,
  price INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1, image TEXT, status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, description TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  target_price INTEGER, proposed_name TEXT, proposed_price INTEGER, proposed_qty INTEGER,
  image TEXT, status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','proposed','approved','rejected','unavailable')),
  note TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_order ON shopping_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, actor_id TEXT, actor_role TEXT,
  type TEXT NOT NULL, message TEXT, meta TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, uploaded_by TEXT NOT NULL, file_name TEXT,
  mime TEXT, data_url TEXT, amount INTEGER, note TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_role TEXT,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'paystack',
  reference TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')),
  method TEXT, provider_payload TEXT, created_at TEXT NOT NULL, verified_at TEXT
);

CREATE TABLE IF NOT EXISTS wallet_entries (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT, type TEXT NOT NULL CHECK (type IN ('credit','debit')),
  amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, description TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_entries(user_id);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  note TEXT, requested_at TEXT NOT NULL, processed_at TEXT
);

CREATE TABLE IF NOT EXISTS job_offers (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, worker_id TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired')),
  created_at TEXT NOT NULL, responded_at TEXT, UNIQUE(order_id, worker_id, role)
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, customer_id TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT, rating INTEGER NOT NULL, comment TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT, kind TEXT,
  order_id TEXT, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS marketing_banners (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, image TEXT, cta_label TEXT, cta_link TEXT,
  bg_color TEXT, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT, sent_count INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, order_id TEXT, customer_id TEXT NOT NULL, subject TEXT NOT NULL,
  category TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending','resolved')), resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_role TEXT,
  body TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, actor_email TEXT, action TEXT NOT NULL, entity TEXT,
  entity_id TEXT, meta TEXT, ip TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

export function migrate() {
  db.exec(SCHEMA);
}

export function reset() {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.pragma('foreign_keys = ON');
  migrate();
}

export { DATA_DIR };
