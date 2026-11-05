/**
 * SQL portability helpers.
 *
 * The API is written against better-sqlite3's synchronous `prepare().get/all/run`
 * API. This module contains the pure, tested pieces needed to move to Postgres:
 * placeholder translation and row shaping. See docs/POSTGRES_MIGRATION.md for the
 * remaining (async) refactor.
 */

/** `?` → `$1, $2, …`, skipping quoted strings and comments. */
export function toPgPlaceholders(sql) {
  let out = '';
  let n = 0;
  let i = 0;
  let quote = null; // ', ", or `
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (quote) {
      out += ch;
      if (ch === quote) {
        if (next === quote) {
          out += next; // escaped quote
          i += 1;
        } else quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { sql: out, count: n };
}

/** Postgres returns `{ rows }`; better-sqlite3 returns arrays. Normalise. */
export const rowsOf = (result) => (Array.isArray(result) ? result : result?.rows || []);

/** Map a pg result to better-sqlite3's `run()` shape. */
export const runShape = (result) => ({ changes: result?.rowCount || 0 });
