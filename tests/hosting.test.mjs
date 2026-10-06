import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

async function helper(name) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { RESERVE_UPLOAD_SQL, RATE_LIMIT_SQL, secretConfigured, matchesSecret, positiveLimit } = await helper('hosting-policy');
const { securityHeaders } = await helper('security-headers');
const migrationDir = new URL('../drizzle/', import.meta.url);
const migrations = await Promise.all((await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort().map(n => readFile(new URL(n, migrationDir), 'utf8')));
function database() {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations) db.exec(migration);
  return db;
}
const run = (db, sql, ...args) => db.prepare(sql).run(Object.fromEntries(args.map((value, i) => [`?${i + 1}`, value])));

test('creator/operator secrets fail closed and configuration limits reject invalid values', async () => {
  assert.equal(secretConfigured(undefined), false);
  assert.equal(secretConfigured('short'), false);
  assert.equal(await matchesSecret('', undefined), false);
  assert.equal(await matchesSecret('x'.repeat(32), 'x'.repeat(32)), true);
  assert.equal(await matchesSecret('x'.repeat(32), 'y'.repeat(32)), false);
  assert.equal(positiveLimit(undefined, 20), 20);
  for (const value of ['-1', '0', 'nonsense', '1.5', Infinity]) assert.throws(() => positiveLimit(value, 20));
});

test('pending uploads reserve both room slots and bytes atomically, including existing rooms', () => {
  const db = database();
  db.exec("INSERT INTO reviews(id,title,filename,file_key,file_size,page_count,owner_name,owner_token_hash) VALUES('existing','t','t.pdf','existing.pdf',50,1,'Owner','hash')");
  const reserve = (id, bytes, rooms = 3) => run(db, RESERVE_UPLOAD_SQL, id, id + '.pdf', bytes, 1000, rooms, 100);
  assert.equal(reserve('one', 30).changes, 1);
  assert.equal(reserve('too-large', 21).changes, 0);
  assert.equal(reserve('two', 20).changes, 1);
  assert.equal(reserve('over-count', 1).changes, 0);
  db.exec("DELETE FROM upload_reservations WHERE review_id='one'");
  assert.equal(reserve('replacement', 30).changes, 1);
  db.close();
});

test('persistent rate buckets refuse excess requests and reset only at window boundary', () => {
  const db = database();
  const hit = (time, key = 'ip-scope') => run(db, RATE_LIMIT_SQL, key, time, 2, 60).changes;
  assert.equal(hit(100), 1);
  assert.equal(hit(101), 1);
  assert.equal(hit(102), 0);
  assert.equal(hit(159), 0);
  assert.equal(hit(160), 1);
  assert.equal(hit(160, 'other'), 1);
  db.close();
});

test('response policy prevents framing and referrer disclosure while allowing PDF WASM', () => {
  const headers = new Headers();
  securityHeaders(headers, 'synthetic-nonce');
  assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(headers.get('content-security-policy'), /script-src 'self' 'nonce-synthetic-nonce' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(headers.get('content-security-policy'), /script-src[^;]*'unsafe-inline'/);
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});
