import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';
import { buildAdoptionSql } from '../scripts/adopt-legacy-schema.mjs';
import { standaloneMigrations } from '../scripts/migration-paths.mjs';

const source = await readFile(new URL('../lib/review-schema.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { assertReviewSchema } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const folder = standaloneMigrations;
const migrations = await Promise.all((await readdir(folder)).filter(n => n.endsWith('.sql')).sort().map(n => readFile(new URL(n, folder), 'utf8')));
const adapter = db => ({ prepare: sql => ({ first: async () => db.prepare(sql).get() ?? null }) });

test('an unmigrated first request cannot create tables or obstruct later migrations', async () => {
  const db = new DatabaseSync(':memory:');
  await assert.rejects(assertReviewSchema(adapter(db)));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 0);
  for (const migration of migrations) db.exec(migration);
  await assertReviewSchema(adapter(db));
  db.exec('DROP TRIGGER annotation_usage_insert');
  await assert.rejects(assertReviewSchema(adapter(db)));
  db.close();
});

test('upgrade preserves existing records, accounts for annotation bytes, and never guesses owner identity', async () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations.slice(0, 4)) db.exec(migration);
  db.exec(`INSERT INTO reviews(id,title,filename,file_key,file_size,page_count,owner_name,owner_token_hash) VALUES('r','t','t.pdf','f',8,1,'Owner','hash');
    INSERT INTO participants(id,review_id,display_name,token_hash) VALUES('p','r','Owner','p-hash');
    INSERT INTO embed_annotations(key,annotation_id,review_id,participant_id,transfer_json,created_at,updated_at) VALUES('r:a','a','r','p','{"example":"é"}','now','now');`);
  db.exec(migrations[4]);
  await assertReviewSchema(adapter(db));
  assert.equal(db.prepare('SELECT is_owner FROM participants').get().is_owner, 0);
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, Buffer.byteLength('{"example":"é"}'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reviews').get().n, 1);
  db.close();
});

test('legacy adoption guards baseline history and rejects drift or an already tracked installation', async () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations.slice(0, 3)) db.exec(migration);
  const sql = await buildAdoptionSql(db);
  db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n, 3);
  await assert.rejects(buildAdoptionSql(db), /history/);
  for (const migration of migrations.slice(3)) db.exec(migration);
  await assertReviewSchema(adapter(db));
  db.close();
  const changed = new DatabaseSync(':memory:');
  for (const migration of migrations.slice(0, 3)) changed.exec(migration);
  changed.exec('ALTER TABLE reviews ADD COLUMN unexpected TEXT');
  await assert.rejects(buildAdoptionSql(changed), /Schema/);
  assert.throws(() => changed.exec(sql));
  assert.equal(changed.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='d1_migrations'").get().n, 0);
  changed.close();
});

test('legacy adoption accepts only the known runtime timestamp default difference', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migrations[0]);
  for (const migration of migrations.slice(1, 3)) {
    db.exec(migration.replace(/(`(?:created_at|updated_at)` text) NOT NULL/g, '$1 DEFAULT CURRENT_TIMESTAMP NOT NULL'));
  }
  db.exec(await buildAdoptionSql(db));
  for (const migration of migrations.slice(3)) db.exec(migration);
  await assertReviewSchema(adapter(db));
  db.close();
});
