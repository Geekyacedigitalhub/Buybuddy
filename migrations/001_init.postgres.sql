-- BUYBUDDY — PostgreSQL 16 schema
-- GENERATED FILE — produced by server/scripts/gen-postgres-ddl.mjs from the SQLite schema.
-- Apply with:  psql "$DATABASE_URL" -f migrations/001_init.postgres.sql
-- Every statement is idempotent (IF NOT EXISTS), so it is safe to re-run.

BEGIN;


CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('customer','shopper','rider','merchant','admin')),
  name text NOT NULL,
  email text UNIQUE,
  phone text UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended','restricted')),
  avatar text,
  city text DEFAULT 'Lagos',
  area text,
  email_verified integer NOT NULL DEFAULT 0,
  phone_verified integer NOT NULL DEFAULT 0,
  token_version integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id text PRIMARY KEY, phone text NOT NULL, code text NOT NULL, purpose text NOT NULL,
  expires_at text NOT NULL, consumed integer NOT NULL DEFAULT 0, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id text PRIMARY KEY, user_id text NOT NULL, token text NOT NULL UNIQUE,
  expires_at text NOT NULL, used integer NOT NULL DEFAULT 0, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id text PRIMARY KEY, user_id text NOT NULL, label text, recipient text, phone text,
  line1 text NOT NULL, area text, city text NOT NULL DEFAULT 'Lagos',
  lat numeric(8,4), lng numeric(8,4), notes text, is_default integer NOT NULL DEFAULT 0, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);

CREATE TABLE IF NOT EXISTS worker_profiles (
  user_id text PRIMARY KEY, roles text NOT NULL DEFAULT 'shopper', vehicle text, plate text,
  service_city text DEFAULT 'Lagos', service_areas text, docs_json text, verified integer NOT NULL DEFAULT 0,
  rating_avg numeric(8,4) NOT NULL DEFAULT 0, rating_count integer NOT NULL DEFAULT 0,
  commission_rate numeric(8,4) NOT NULL DEFAULT 0.15, available integer NOT NULL DEFAULT 1,
  bank_name text, bank_code text, account_name text, account_number text,
  rejection_reason text, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS merchant_profiles (
  user_id text PRIMARY KEY, business_name text NOT NULL, cac_number text, business_address text,
  docs_json text, verified integer NOT NULL DEFAULT 0, rejection_reason text,
  bank_name text, bank_code text, account_name text, account_number text, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, icon text,
  parent_id text, sort integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stores (
  id text PRIMARY KEY, merchant_id text NOT NULL, name text NOT NULL, slug text UNIQUE NOT NULL,
  description text, logo text, cover text, area text, city text DEFAULT 'Lagos', phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  is_open integer NOT NULL DEFAULT 1, rating_avg numeric(8,4) NOT NULL DEFAULT 0, rating_count integer NOT NULL DEFAULT 0,
  commission_rate numeric(8,4) NOT NULL DEFAULT 0.12, opens_at text DEFAULT '08:00', closes_at text DEFAULT '21:00',
  prep_minutes integer NOT NULL DEFAULT 20, min_order integer NOT NULL DEFAULT 0,
  suspended_reason text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stores_merchant ON stores(merchant_id);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY, store_id text NOT NULL, category_id text, name text NOT NULL,
  description text, price integer NOT NULL, compare_at integer, image text, unit text,
  stock integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  tags text, rating_avg numeric(8,4) NOT NULL DEFAULT 0, rating_count integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS favourites (
  user_id text NOT NULL, product_id text NOT NULL, created_at text NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id text PRIMARY KEY, user_id text NOT NULL, product_id text NOT NULL, qty integer NOT NULL DEFAULT 1,
  created_at text NOT NULL, UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS promos (
  code text PRIMARY KEY, description text, type text NOT NULL CHECK (type IN ('percent','fixed','free_delivery')),
  value integer NOT NULL DEFAULT 0, min_subtotal integer NOT NULL DEFAULT 0, max_discount integer,
  usage_limit integer, used_count integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 1,
  expires_at text, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, code text UNIQUE NOT NULL, customer_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('merchant','personal')),
  store_id text, status text NOT NULL, subtotal integer NOT NULL DEFAULT 0,
  service_fee integer NOT NULL DEFAULT 0, delivery_fee integer NOT NULL DEFAULT 0,
  tax integer NOT NULL DEFAULT 0, discount integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NGN', payment_method text NOT NULL DEFAULT 'paystack',
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded','paid_cash')),
  promo_code text, address_json text, notes text, instructions text,
  budget integer, service_level text DEFAULT 'standard', scheduled_for text,
  shopper_id text, rider_id text, delivery_pin text, idempotency_key text UNIQUE,
  cancel_reason text, approved_subtotal integer, distance_km numeric(8,4) DEFAULT 3.5,
  created_at text NOT NULL, updated_at text NOT NULL, completed_at text
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_shopper ON orders(shopper_id);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);

CREATE TABLE IF NOT EXISTS order_items (
  id text PRIMARY KEY, order_id text NOT NULL, product_id text, name text NOT NULL,
  price integer NOT NULL, qty integer NOT NULL DEFAULT 1, image text, status text NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS shopping_items (
  id text PRIMARY KEY, order_id text NOT NULL, description text NOT NULL, qty integer NOT NULL DEFAULT 1,
  target_price integer, proposed_name text, proposed_price integer, proposed_qty integer,
  image text, status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','proposed','approved','rejected','unavailable')),
  note text, updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_order ON shopping_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id text PRIMARY KEY, order_id text NOT NULL, actor_id text, actor_role text,
  type text NOT NULL, message text, meta text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS receipts (
  id text PRIMARY KEY, order_id text NOT NULL, uploaded_by text NOT NULL, file_name text,
  mime text, data_url text, amount integer, note text, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY, order_id text NOT NULL, sender_id text NOT NULL, sender_role text,
  body text NOT NULL, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, order_id text NOT NULL, provider text NOT NULL DEFAULT 'paystack',
  reference text UNIQUE NOT NULL, amount integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','refunded')),
  method text, provider_payload text, created_at text NOT NULL, verified_at text
);

CREATE TABLE IF NOT EXISTS wallet_entries (
  id text PRIMARY KEY, user_id text NOT NULL, order_id text, type text NOT NULL CHECK (type IN ('credit','debit')),
  amount integer NOT NULL, balance_after integer NOT NULL, description text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_entries(user_id);

CREATE TABLE IF NOT EXISTS payouts (
  id text PRIMARY KEY, worker_id text NOT NULL, amount integer NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  note text, requested_at text NOT NULL, processed_at text
);

CREATE TABLE IF NOT EXISTS job_offers (
  id text PRIMARY KEY, order_id text NOT NULL, worker_id text NOT NULL, role text NOT NULL,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','expired')),
  created_at text NOT NULL, responded_at text, UNIQUE(order_id, worker_id, role)
);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY, order_id text NOT NULL, customer_id text NOT NULL, target_type text NOT NULL,
  target_id text, rating integer NOT NULL, comment text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')), created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, user_id text NOT NULL, title text NOT NULL, body text, kind text,
  order_id text, read integer NOT NULL DEFAULT 0, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS marketing_banners (
  id text PRIMARY KEY, title text NOT NULL, subtitle text, image text, cta_label text, cta_link text,
  bg_color text, active integer NOT NULL DEFAULT 1, sort integer NOT NULL DEFAULT 0, created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, payload text, status text NOT NULL DEFAULT 'draft',
  scheduled_at text, sent_count integer NOT NULL DEFAULT 0, created_by text, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY, order_id text, customer_id text NOT NULL, subject text NOT NULL,
  category text, priority text NOT NULL DEFAULT 'normal', status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending','resolved')), resolution text, created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS support_messages (
  id text PRIMARY KEY, ticket_id text NOT NULL, sender_id text NOT NULL, sender_role text,
  body text NOT NULL, created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_entries (
  id text PRIMARY KEY, user_id text NOT NULL, order_id text,
  type text NOT NULL CHECK (type IN ('earn','redeem','adjust')),
  points integer NOT NULL, balance_after integer NOT NULL,
  description text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_entries(user_id);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id text PRIMARY KEY, referrer_id text NOT NULL, referee_id text NOT NULL,
  order_id text, referrer_amount integer NOT NULL, referee_amount integer NOT NULL,
  created_at text NOT NULL, UNIQUE(referee_id)
);

CREATE TABLE IF NOT EXISTS saved_lists (
  id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL,
  items_json text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_lists_user ON saved_lists(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY, actor_id text, actor_email text, action text NOT NULL, entity text,
  entity_id text, meta text, ip text, created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Columns added after v1.0 (mirrors ensureColumn() in db.js)
ALTER TABLE users  ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS referred_by text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

COMMIT;
