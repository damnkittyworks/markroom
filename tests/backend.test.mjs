import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Compile only pure backend helpers in memory; tests never load Workers bindings.
async function helper(name) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { validateEmbedTransfer, publicAnnotationRecord } = await helper('embed-validation');
const { inspectPdfStream, readJsonObject } = await helper('request-validation');
const { INSERT_ANNOTATION_SQL, UPDATE_ANNOTATION_SQL, INSERT_PARTICIPANT_SQL } = await helper('review-write-sql');
const rect = { origin: { x: 10, y: 20 }, size: { width: 30, height: 40 } };
const note = () => ({ annotation: { id: 'note-1', type: 1, pageIndex: 0, rect: structuredClone(rect), contents: 'Synthetic review', flags: ['print'], created: '2026-10-03T12:00:00.000Z' } });
const valid = (input) => validateEmbedTransfer(input, { annotationId: 'note-1', pageCount: 2, authorName: 'Original author' });

test('valid portable notes and supported geometry survive; malformed consumed fields fail', () => {
  assert.equal(valid(note()).annotation.author, 'Original author');
  for (const patch of [{ flags: 'invalid-array' }, { flags: ['bogus'] }, { created: 'yesterday' }, { rect: { origin: [], size: {} } }, { pageIndex: 2 }, { contents: {} }, { type: 15, inkList: 'bad' }, { type: 7, vertices: [1, 2] }, { type: 9, segmentRects: [{}] }]) {
    assert.equal(valid({ annotation: { ...note().annotation, ...patch } }), null, JSON.stringify(patch));
  }
  for (const [type, geometry] of [[4, { linePoints: { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } } }], [7, { vertices: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] }], [9, { segmentRects: [rect] }], [15, { inkList: [{ points: [{ x: 1, y: 2 }] }] }]]) {
    assert.ok(valid({ annotation: { ...note().annotation, type, ...geometry } }));
  }
  assert.equal(valid(JSON.parse('{"annotation":{"__proto__":{}}}')), null);
  assert.equal(valid({ ...note(), ctx: {} }), null);
  const stripped = valid({ annotation: { ...note().annotation, custom: { arbitrary: 'data' }, richContent: '<script>bad()</script>' } });
  assert.equal(stripped.annotation.custom, undefined);
  assert.equal(stripped.annotation.richContent, undefined);
});

test('links only permit web/mail and bounded local destinations; reply IDs and kinds are checked', () => {
  const withUri = (uri) => ({ annotation: { ...note().annotation, type: 2, target: { type: 'action', action: { type: 3, uri } } } });
  for (const uri of ['https://example.test/path', 'http://example.test/', 'mailto:reviewer@example.test']) assert.ok(valid(withUri(uri)));
  for (const uri of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https:\n//example.test']) assert.equal(valid(withUri(uri)), null);
  assert.equal(valid({ annotation: { ...note().annotation, type: 2, target: { type: 'action', action: { type: 4, path: '/tmp/example' } } } }), null);
  assert.ok(valid({ annotation: { ...note().annotation, inReplyToId: 'parent', replyType: 1 } }));
  assert.equal(valid({ annotation: { ...note().annotation, inReplyToId: 'note-1' } }), null);
  assert.equal(valid({ annotation: { ...note().annotation, type: 5, inReplyToId: 'parent' } }), null);
});

test('public tombstones never contain deleted payloads; corrupt legacy rows are isolated', () => {
  const row = { id: 'note-1', authorId: 'person', authorName: 'Author', revision: 2, deleted: 1, transferJson: JSON.stringify({ annotation: { ...note().annotation, contents: 'DELETED_PRIVATE_PHRASE' } }), createdAt: 'now', updatedAt: 'now' };
  const tombstone = publicAnnotationRecord(row, 2);
  assert.equal(tombstone.transfer, null);
  assert.equal(tombstone.deleted, true);
  assert.ok(!JSON.stringify(tombstone).includes('DELETED_PRIVATE_PHRASE'));
  for (const transferJson of ['{malformed', JSON.stringify({ annotation: { ...note().annotation, flags: {} } })]) {
    const result = publicAnnotationRecord({ ...row, deleted: 0, transferJson }, 2);
    assert.equal(result.transfer, null);
    assert.equal(result.invalid, true);
  }
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE reviews (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE participants (id TEXT PRIMARY KEY, review_id TEXT, display_name TEXT, token_hash TEXT, created_at TEXT, last_seen_at TEXT);
    CREATE TABLE embed_annotations (key TEXT PRIMARY KEY, annotation_id TEXT, review_id TEXT, participant_id TEXT, transfer_json TEXT, revision INTEGER, deleted INTEGER, created_at TEXT, updated_at TEXT);
    INSERT INTO reviews VALUES ('room', 'open');`);
  // Node 22 treats ?N placeholders as named parameters. Map D1's positional
  // arguments explicitly so these same SQL statements work on every supported Node.
  const run = (sql, ...values) => db.prepare(sql).run(Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value])));
  const insert = (id, limit = 3, parent = null, parentRev = null, bytes = 10000) => run(INSERT_ANNOTATION_SQL, `room:${id}`, id, 'room', 'author', JSON.stringify(note()), 'now', limit, bytes, parent, parentRev);
  const update = (id, revision, { deleted = 0, author = 'author', owner = 0, parent = null, parentRev = null, bytes = 10000, content = JSON.stringify(note()) } = {}) => run(UPDATE_ANNOTATION_SQL, deleted ? '{}' : content, deleted, 'later', `room:${id}`, 'room', revision, author, owner, bytes, parent, parentRev);
  const join = (id, limit = 2) => run(INSERT_PARTICIPANT_SQL, id, 'room', 'Test', id, 'now', limit);
  return { db, insert, update, join };
}

test('upgrade migration scrubs old tombstones while preserving live contents and revisions', async () => {
  const { db, insert } = fixture();
  insert('live'); insert('deleted');
  db.exec("UPDATE embed_annotations SET deleted=1, revision=7 WHERE annotation_id='deleted'");
  const before = db.prepare("SELECT transfer_json FROM embed_annotations WHERE annotation_id='live'").get();
  db.exec(await readFile(new URL('../drizzle/0003_scrub_deleted_annotations.sql', import.meta.url), 'utf8'));
  assert.deepEqual({ ...db.prepare("SELECT transfer_json, revision FROM embed_annotations WHERE annotation_id='deleted'").get() }, { transfer_json: '{}', revision: 7 });
  assert.equal(db.prepare("SELECT transfer_json FROM embed_annotations WHERE annotation_id='live'").get().transfer_json, before.transfer_json);
  db.close();
});

test('commit-time close guards reject adds, edits, deletes, restores, and joins after an earlier open read', () => {
  const { db, insert, update, join } = fixture();
  assert.equal(insert('existing').changes, 1);
  assert.equal(insert('deleted').changes, 1);
  assert.equal(update('deleted', 1, { deleted: 1 }).changes, 1);
  assert.equal(db.prepare("SELECT status FROM reviews WHERE id='room'").get().status, 'open');
  // This is the critical race interleaving: close commits after validation, before write.
  db.exec("UPDATE reviews SET status='closed' WHERE id='room'");
  assert.equal(insert('late').changes, 0);
  assert.equal(update('existing', 1).changes, 0);
  assert.equal(update('existing', 1, { deleted: 1 }).changes, 0);
  assert.equal(update('deleted', 2).changes, 0);
  assert.equal(join('late-person').changes, 0);
  db.close();
});

test('revision, ownership, parent revision and retained/data quotas are enforced in the write', () => {
  const { db, insert, update, join } = fixture();
  assert.equal(insert('one', 1).changes, 1);
  assert.equal(insert('one', 1).changes, 0);
  assert.equal(update('one', 1, { author: 'other' }).changes, 0);
  assert.equal(update('one', 1, { author: 'owner-person', owner: 1 }).changes, 1);
  assert.equal(update('one', 1).changes, 0); // stale concurrent update
  assert.equal(update('one', 2, { deleted: 1 }).changes, 1);
  assert.equal(insert('two', 1).changes, 0); // deleted rows still consume retained quota
  assert.equal(update('one', 3).changes, 1); // restore does not create another retained row
  assert.equal(insert('child', 3, 'room:one', 1).changes, 0); // parent changed since validation
  assert.equal(insert('child', 3, 'room:one', 4).changes, 1);
  assert.equal(update('one', 4, { deleted: 1 }).changes, 1);
  assert.equal(update('child', 1, { parent: 'room:one', parentRev: 5 }).changes, 0);
  assert.equal(insert('oversize', 3, null, null, 1).changes, 0);
  assert.equal(update('child', 1, { bytes: 1 }).changes, 0);
  assert.equal(join('first', 1).changes, 1);
  assert.equal(join('second', 1).changes, 0);
  db.close();
});

function chunks(parts) { return new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }); }
async function drain(stream) { const reader = stream.getReader(); while (!(await reader.read()).done) {} }

test('PDF inspection counts actual streaming bytes across chunks and rejects invalid, short, oversized bodies', async () => {
  const parts = ['%PD', 'F-1.', '7\n', 'synthetic'];
  const size = parts.join('').length;
  const inspected = inspectPdfStream(chunks(parts), size, size);
  await drain(inspected.stream);
  assert.equal(inspected.size(), size);
  await assert.rejects(drain(inspectPdfStream(chunks(['not-a-pdf']), 9, 100).stream), { status: 415 });
  await assert.rejects(drain(inspectPdfStream(chunks(['%PDF-1.7']), 12, 100).stream), { status: 400 });
  await assert.rejects(drain(inspectPdfStream(chunks(['%PDF-1.7more']), 8, 100).stream), { status: 413 });
  await assert.rejects(drain(inspectPdfStream(chunks(['%PDF-1.7more']), 100, 8).stream), { status: 413 });
  await assert.rejects(drain(inspectPdfStream(chunks([]), 1, 100).stream), { status: 415 });
});

test('JSON input is bounded before parsing and requires an object', async () => {
  const request = (body) => new Request('https://local.invalid', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.deepEqual(await readJsonObject(request('{"action":"close"}')), { action: 'close' });
  for (const body of ['null', '[]', '{bad', '"text"']) await assert.rejects(readJsonObject(request(body)), { status: 400 });
  await assert.rejects(readJsonObject(request('{"large":"1234567890"}'), 10), { status: 413 });
  await assert.rejects(readJsonObject(new Request('https://local.invalid', { method: 'POST' })), { status: 415 });
});
