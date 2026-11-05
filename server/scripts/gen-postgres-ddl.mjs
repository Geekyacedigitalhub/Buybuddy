/**
 * Generates migrations/001_init.postgres.sql from the single source of truth
 * (the SQLite schema in server/src/lib/db.js).
 *
 * Run: node server/scripts/gen-postgres-ddl.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbSource = fs.readFileSync(path.join(here, '../src/lib/db.js'), 'utf8');
const schemaMatch = dbSource.match(/const SCHEMA = `([\s\S]*?)`;/);
if (!schemaMatch) throw new Error('Could not locate SCHEMA in db.js');

const translated = schemaMatch[1]
  .replace(/\bINTEGER\b/g, 'integer')
  .replace(/\bREAL\b/g, 'numeric(8,4)')
  .replace(/\bTEXT\b/g, 'text');

const header = `-- BUYBUDDY — PostgreSQL 16 schema
-- GENERATED FILE — produced by server/scripts/gen-postgres-ddl.mjs from the SQLite schema.
-- Apply with:  psql "$DATABASE_URL" -f migrations/001_init.postgres.sql
-- Every statement is idempotent (IF NOT EXISTS), so it is safe to re-run.

BEGIN;

`;

const footer = `
-- Columns added after v1.0 (mirrors ensureColumn() in db.js)
ALTER TABLE users  ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS referred_by text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_earned integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

COMMIT;
`;

const outPath = path.join(here, '../../migrations/001_init.postgres.sql');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const content = header + translated + footer;
fs.writeFileSync(outPath, content);
console.log(`wrote ${outPath} (${content.split('\n').length} lines, ${(content.match(/CREATE TABLE/g) || []).length} tables)`);
