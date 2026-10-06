#!/usr/bin/env node
// Offline only: inspect a SQLite backup and produce guarded adoption SQL.
// Never connects to Cloudflare, modifies the backup, or applies migrations.
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_MIGRATIONS = ['0000_romantic_stone_men.sql', '0001_secret_doctor_strange.sql', '0002_acoustic_bedlam.sql'];
const quote = (value) => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const tables = ['reviews', 'participants', 'annotations', 'replies', 'native_annotations', 'embed_annotations'];

export async function legacySchemaGuard() {
  const expected = new DatabaseSync(':memory:');
  for (const file of BASELINE_MIGRATIONS) expected.exec(await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
  const predicates = ["NOT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'markroom_schema')"];
  for (const table of tables) {
    const rows = expected.prepare(`SELECT name, upper(type) AS type, "notnull", dflt_value, pk FROM pragma_table_info(${quote(table)})`).all();
    predicates.push(`(SELECT COUNT(*) FROM pragma_table_info(${quote(table)})) = ${rows.length}`);
    for (const row of rows) {
      const runtimeTimestamp = ['native_annotations', 'embed_annotations'].includes(table) && ['created_at', 'updated_at'].includes(row.name) && row.dflt_value === null;
      const defaultCheck = runtimeTimestamp ? "(dflt_value IS NULL OR upper(dflt_value) = 'CURRENT_TIMESTAMP')" : `dflt_value IS ${quote(row.dflt_value)}`;
      predicates.push(`EXISTS (SELECT 1 FROM pragma_table_info(${quote(table)}) WHERE name = ${quote(row.name)} AND upper(type) = ${quote(row.type)} AND "notnull" = ${row.notnull} AND ${defaultCheck} AND pk = ${row.pk})`);
    }
    const foreignKeys = expected.prepare(`SELECT "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(${quote(table)})`).all();
    predicates.push(`(SELECT COUNT(*) FROM pragma_foreign_key_list(${quote(table)})) = ${foreignKeys.length}`);
    for (const key of foreignKeys) {
      predicates.push(`EXISTS (SELECT 1 FROM pragma_foreign_key_list(${quote(table)}) WHERE ${Object.entries(key).map(([name, value]) => `"${name}" = ${quote(value)}`).join(' AND ')})`);
    }
    const indexes = expected.prepare(`SELECT name, "unique", partial FROM pragma_index_list(${quote(table)}) WHERE origin = 'c'`).all();
    predicates.push(`(SELECT COUNT(*) FROM pragma_index_list(${quote(table)}) WHERE origin = 'c') = ${indexes.length}`);
    for (const index of indexes) {
      predicates.push(`EXISTS (SELECT 1 FROM pragma_index_list(${quote(table)}) WHERE name = ${quote(index.name)} AND "unique" = ${index.unique} AND partial = ${index.partial})`);
      const columns = expected.prepare(`SELECT seqno, name FROM pragma_index_info(${quote(index.name)})`).all();
      predicates.push(`(SELECT COUNT(*) FROM pragma_index_info(${quote(index.name)})) = ${columns.length}`);
      for (const column of columns) predicates.push(`EXISTS (SELECT 1 FROM pragma_index_info(${quote(index.name)}) WHERE seqno = ${column.seqno} AND name = ${quote(column.name)})`);
    }
  }
  expected.close();
  // D1 limits expression depth to 100. A flat left-associative AND chain of
  // all column/index checks exceeds that; a balanced tree preserves every check.
  function conjunction(items) {
    if (items.length === 1) return items[0];
    const middle = Math.floor(items.length / 2);
    return `(${conjunction(items.slice(0, middle))}\nAND ${conjunction(items.slice(middle))})`;
  }
  return conjunction(predicates);
}

export async function buildAdoptionSql(db) {
  const guard = await legacySchemaGuard();
  if (!db.prepare(`SELECT (${guard}) AS valid`).get().valid) throw new Error('Schema does not exactly match the legacy baseline. Refusing adoption; review this installation manually.');
  const hasHistory = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get();
  if (hasHistory && db.prepare('SELECT 1 FROM d1_migrations LIMIT 1').get()) throw new Error('Migration history is already present. Refusing to replace or extend it.');
  return `-- Generated from a verified backup. Review and back up the target before use.
-- These guards recheck the target; only migrations 0000–0002 are baselined.
-- Stop immediately on any SQL error. Then apply ordinary pending migrations.
SELECT CASE WHEN (${guard}) THEN 1 ELSE json_extract('Markroom legacy schema mismatch', '$') END;
CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM d1_migrations) THEN 1 ELSE json_extract('Markroom migration history already exists', '$') END;
INSERT INTO d1_migrations (name) VALUES ${BASELINE_MIGRATIONS.map((name) => `(${quote(name)})`).join(', ')};
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--database' || args[2] !== '--output') throw new Error('Usage: node scripts/adopt-legacy-schema.mjs --database /path/to/backup.sqlite --output /path/to/adopt.sql');
    if (resolve(args[1]) === resolve(args[3])) throw new Error('Output must not overwrite the backup.');
    const db = new DatabaseSync(args[1], { readOnly: true });
    try { await writeFile(args[3], await buildAdoptionSql(db), { flag: 'wx' }); } finally { db.close(); }
    process.stdout.write('Verified the backup and wrote guarded adoption SQL. Nothing was applied. Back up and review the target before executing it; then apply pending migrations normally.\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
