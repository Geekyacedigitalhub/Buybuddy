import { db } from './db.js';

/**
 * The database is a single SQLite file with no server to talk to, so a backup
 * is just "every row, as JSON". That survives a schema-compatible restore into
 * a fresh container, which is exactly what a free host does on every deploy.
 *
 * Order matters on restore: parents before children, or the foreign keys (which
 * are ON for good reason) will refuse the inserts.
 */
/**
 * Table order is derived from the schema itself rather than typed out by hand:
 * a hardcoded list drifts the moment someone adds a table, and a missing table
 * in a backup is silent data loss. Parents come before children via a
 * topological sort over the real foreign keys.
 */
export function tableOrder() {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  const deps = new Map();
  for (const n of names) {
    const refs = db
      .prepare(`PRAGMA foreign_key_list("${n}")`)
      .all()
      .map((f) => f.table)
      .filter((t) => t !== n && names.includes(t));
    deps.set(n, new Set(refs));
  }
  const order = [];
  const seen = new Set();
  while (order.length < names.length) {
    let progressed = false;
    for (const n of names) {
      if (seen.has(n)) continue;
      if ([...deps.get(n)].every((d) => seen.has(d))) {
        order.push(n);
        seen.add(n);
        progressed = true;
      }
    }
    if (!progressed) {
      // a cycle: take the rest as-is, foreign keys are off during restore anyway
      for (const n of names) if (!seen.has(n)) { order.push(n); seen.add(n); }
    }
  }
  return order;
}

export function dumpDatabase() {
  const out = { app: 'buybuddy', version: 1, taken_at: new Date().toISOString(), tables: {} };
  for (const t of tableOrder()) {
    try {
      out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    } catch {
      // a table that does not exist in this build is simply absent from the dump
    }
  }
  out.counts = Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.length]));
  return out;
}

export function restoreDatabase(dump) {
  if (!dump || dump.app !== 'buybuddy' || typeof dump.tables !== 'object') {
    throw new Error('That file is not a BUYBUDDY backup.');
  }
  const order = tableOrder();
  const known = new Set(order);
  const problems = [];
  db.pragma('foreign_keys = OFF');
  const run = db.transaction(() => {
    // children first when clearing, so nothing is orphaned mid-way
    for (const t of [...order].reverse()) {
      const rows = dump.tables[t];
      if (!Array.isArray(rows)) continue;
      db.prepare(`DELETE FROM ${t}`).run();
    }
    for (const t of order) {
      const rows = dump.tables[t];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c));
        if (!cols.length) continue;
        try {
          db.prepare(
            `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
          ).run(...cols.map((c) => row[c]));
        } catch (e) {
          problems.push(`${t}: ${e.message}`);
        }
      }
    }
  });
  try {
    run();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const foreignKeys = db.pragma('foreign_key_check');
  return {
    restored: Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    skipped_tables: Object.keys(dump.tables).filter((t) => !known.has(t)),
    row_errors: problems.slice(0, 20),
    row_error_count: problems.length,
    broken_foreign_keys: foreignKeys.length,
  };
}
