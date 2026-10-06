import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const requestUrl = moduleUrl(compile(await readFile(new URL('../lib/request-validation.ts', import.meta.url), 'utf8')));
const schemaUrl = moduleUrl(compile(await readFile(new URL('../lib/review-schema.ts', import.meta.url), 'utf8')));
const initializationUrl = moduleUrl(compile(await readFile(new URL('../lib/review-initialization.ts', import.meta.url), 'utf8'))
  .replace('"./request-validation"', JSON.stringify(requestUrl)).replace('"./review-schema"', JSON.stringify(schemaUrl)));
const { initializeReviewData } = await import(initializationUrl);
const { assertReviewSchema } = await import(schemaUrl);
const migrationFiles = ['0000_romantic_stone_men.sql', '0001_secret_doctor_strange.sql', '0002_acoustic_bedlam.sql', '0003_sites_hosting_schema.sql'];
const migrations = await Promise.all(migrationFiles.map(name => readFile(new URL(`../drizzle-sites/${name}`, import.meta.url), 'utf8')));

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations.slice(0, 3)) db.exec(migration);
  db.exec(`INSERT INTO reviews(id,title,filename,file_key,file_size,page_count,owner_name,owner_token_hash) VALUES('r','Preserved','t.pdf','f',8,1,'Owner','hash');
    INSERT INTO participants(id,review_id,display_name,token_hash) VALUES('p','r','Owner','p-hash');
    INSERT INTO embed_annotations(key,annotation_id,review_id,participant_id,transfer_json,deleted,revision,created_at,updated_at)
    VALUES('r:a','a','r','p','{"contents":"é 🐈"}',0,3,'before','before'),('r:b','b','r','p','{"contents":"deleted secret"}',1,7,'before','before');
    INSERT INTO annotations(id,review_id,participant_id,page_number,kind,x,y,pdf_x,pdf_y,body) VALUES('legacy','r','p',1,'pin',0,0,0,0,'retained historical note');`);
  db.exec(migrations[3]);
  return db;
}

function adapter(db, { beforeBatch } = {}) {
  return {
    prepare: sql => ({ sql, first: async () => db.prepare(sql).get() ?? null }),
    batch: async statements => {
      if (beforeBatch) await beforeBatch();
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql }) => ({ meta: { changes: db.prepare(sql).run().changes } }));
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
const actualBytes = db => db.prepare('SELECT COALESCE(SUM(length(CAST(transfer_json AS BLOB))),0) AS bytes FROM embed_annotations').get().bytes;

test('Sites profile preserves the previously applied migration baseline byte for byte', async () => {
  for (let index = 0; index < 3; index++) {
    assert.equal(migrations[index], await readFile(new URL(`../drizzle/${migrationFiles[index]}`, import.meta.url), 'utf8'));
  }
});

test('missing schema or accounting triggers rejects initialization without creating or writing anything', async () => {
  const empty = new DatabaseSync(':memory:');
  await assert.rejects(initializeReviewData(adapter(empty)), { status: 503 });
  assert.equal(empty.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
  empty.close();
  const db = fixture();
  db.exec('DROP TRIGGER annotation_usage_update');
  await assert.rejects(initializeReviewData(adapter(db)), { status: 503 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM annotation_usage').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM markroom_schema').get().n, 0);
  assert.match(db.prepare("SELECT transfer_json FROM embed_annotations WHERE deleted=1").get().transfer_json, /deleted secret/);
  db.close();
});

test('explicit initialization reconciles UTF-8 bytes, scrubs tombstones, and preserves data and roles', async () => {
  const db = fixture();
  // An incomplete previous operator attempt may have left a stale zero counter.
  db.exec('INSERT INTO annotation_usage VALUES(1,0)');
  assert.equal(await initializeReviewData(adapter(db)), 'initialized');
  await assertReviewSchema(adapter(db));
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, Buffer.byteLength('{"contents":"é 🐈"}') + 2);
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, actualBytes(db));
  assert.deepEqual({ ...db.prepare("SELECT transfer_json,revision,updated_at FROM embed_annotations WHERE deleted=1").get() }, { transfer_json: '{}', revision: 7, updated_at: 'before' });
  assert.equal(db.prepare('SELECT body FROM annotations').get().body, 'retained historical note');
  assert.equal(db.prepare('SELECT is_owner FROM participants').get().is_owner, 0);
  assert.equal(db.prepare('SELECT title FROM reviews').get().title, 'Preserved');
  db.exec("UPDATE embed_annotations SET transfer_json='{\"contents\":\"later é\"}' WHERE key='r:a'");
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, actualBytes(db));
  db.close();
});

test('ready replay performs no writes, including scrub and counter reconciliation', async () => {
  const db = fixture();
  await initializeReviewData(adapter(db));
  db.exec("UPDATE embed_annotations SET transfer_json='{\"contents\":\"post-init\"}' WHERE deleted=1");
  const bytes = actualBytes(db);
  const noBatch = { ...adapter(db), batch: async () => { throw new Error('unexpected write'); } };
  assert.equal(await initializeReviewData(noBatch), 'alreadyReady');
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, bytes);
  assert.match(db.prepare('SELECT transfer_json FROM embed_annotations WHERE deleted=1').get().transfer_json, /post-init/);
  db.close();
});

test('a failure at the final marker rolls back scrubbing and accounting; a retry succeeds', async () => {
  const db = fixture();
  db.exec("CREATE TRIGGER test_reject_marker BEFORE INSERT ON markroom_schema BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  await assert.rejects(initializeReviewData(adapter(db)), /synthetic failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM annotation_usage').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM markroom_schema').get().n, 0);
  assert.match(db.prepare('SELECT transfer_json FROM embed_annotations WHERE deleted=1').get().transfer_json, /deleted secret/);
  db.exec('DROP TRIGGER test_reject_marker');
  assert.equal(await initializeReviewData(adapter(db)), 'initialized');
  db.close();
});

test('another initializer completing after the initial read makes all queued DML a no-op', async () => {
  const db = fixture();
  const first = adapter(db, { beforeBatch: async () => {
    assert.equal(await initializeReviewData(adapter(db)), 'initialized');
    db.exec("UPDATE embed_annotations SET transfer_json='{\"contents\":\"concurrent post-init\"}' WHERE deleted=1");
  } });
  assert.equal(await initializeReviewData(first), 'alreadyReady');
  assert.match(db.prepare('SELECT transfer_json FROM embed_annotations WHERE deleted=1').get().transfer_json, /concurrent post-init/);
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, actualBytes(db));
  db.close();
});

test('operator endpoint rejects authorization before obtaining a database or initializing data', async () => {
  const authUrl = moduleUrl(`import { RequestError } from ${JSON.stringify(requestUrl)}; export async function requireOperator() { throw new RequestError('Operator authorization required.',403); }`);
  const dbUrl = moduleUrl("export function getReviewD1() { throw new Error('database accessed before auth'); }");
  const route = compile(await readFile(new URL('../app/api/operator/initialize/route.ts', import.meta.url), 'utf8'))
    .replace('"../../../../lib/hosting-controls"', JSON.stringify(authUrl))
    .replace('"../../../../lib/review-initialization"', JSON.stringify(initializationUrl))
    .replace('"../../../../lib/review-server"', JSON.stringify(dbUrl))
    .replace('"../../../../lib/request-validation"', JSON.stringify(requestUrl));
  const { POST } = await import(moduleUrl(route));
  const response = await POST(new Request('https://local.invalid/api/operator/initialize', { method: 'POST' }));
  assert.equal(response.status, 403);
});
