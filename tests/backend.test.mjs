import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

// Compile only pure backend helpers in memory; tests never load Workers bindings.
async function helper(name) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { validateEmbedTransfer, publicAnnotationRecord, validateAnnotationThreads } = await helper('embed-validation');
const { inspectPdfStream, readJsonObject } = await helper('request-validation');
const { INSERT_ANNOTATION_SQL, UPDATE_ANNOTATION_SQL, INSERT_PARTICIPANT_SQL } = await helper('review-write-sql');
const { participantNameKey, participantAuthorLabel } = await helper('participant-label');
const { protectedThreadIds } = await helper('thread-deletion');
const migrationDir = new URL('../drizzle/', import.meta.url);
const migrations = await Promise.all((await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort().map((name) => readFile(new URL(name, migrationDir), 'utf8')));
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
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) db.exec(migration);
  db.exec(`INSERT INTO reviews (id,title,filename,file_key,file_size,page_count,owner_name,owner_token_hash,status)
    VALUES ('room','Test','test.pdf','test',8,2,'Owner','owner-token','open');
    INSERT INTO participants (id,review_id,display_name,token_hash,name_key,is_owner) VALUES
    ('author','room','Author','author-token','author',0), ('owner-person','room','Owner','owner-person-token','owner',1);`);
  // Node 22 treats ?N placeholders as named parameters. Map D1's positional
  // arguments explicitly so these same SQL statements work on every supported Node.
  const run = (sql, ...values) => db.prepare(sql).run(Object.fromEntries(values.map((value, index) => [`?${index + 1}`, value])));
  const insert = (id, limit = 10, parent = null, parentRev = null, bytes = 10000, active = 5, globalBytes = 100000) => {
    const transfer = note();
    transfer.annotation.id = id;
    if (parent) transfer.annotation.inReplyToId = parent.slice('room:'.length);
    return run(INSERT_ANNOTATION_SQL, `room:${id}`, id, 'room', 'author', JSON.stringify(transfer), 'now', limit, bytes, parent, parentRev, active, globalBytes);
  };
  const update = (id, revision, { deleted = 0, author = 'author', owner = 0, parent = null, parentRev = null, bytes = 10000, content = JSON.stringify(note()), active = 5, globalBytes = 100000 } = {}) => run(UPDATE_ANNOTATION_SQL, deleted ? '{}' : content, deleted, 'later', `room:${id}`, 'room', revision, author, owner, bytes, parent, parentRev, active, globalBytes);
  const join = (id, limit = 10, name = id) => run(INSERT_PARTICIPANT_SQL, id, 'room', name, id, 'now', limit, participantNameKey(name));
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
  assert.equal(update('one', 4, { deleted: 1 }).changes, 0); // cannot orphan a live reply
  assert.equal(update('child', 1, { parent: 'room:one', parentRev: 5 }).changes, 0);
  assert.equal(insert('oversize', 3, null, null, 1).changes, 0);
  assert.equal(update('child', 1, { bytes: 1 }).changes, 0);
  assert.equal(join('first', 3).changes, 1);
  assert.equal(join('second', 3).changes, 0);
  db.close();
});

test('parent deletion and reply creation reject both unsafe race interleavings', () => {
  const { db, insert, update } = fixture();
  assert.equal(insert('parent').changes, 1);
  assert.equal(insert('reply', 10, 'room:parent', 1).changes, 1);
  // Delete validated before reply insertion must still fail at commit.
  assert.equal(update('parent', 1, { deleted: 1 }).changes, 0);
  assert.equal(db.prepare("SELECT deleted FROM embed_annotations WHERE annotation_id='parent'").get().deleted, 0);
  assert.equal(update('reply', 1, { deleted: 1 }).changes, 1);
  assert.equal(update('parent', 1, { deleted: 1 }).changes, 1);
  // Reply validated before parent deletion must still fail at commit.
  assert.equal(insert('late', 10, 'room:parent', 1).changes, 0);
  db.close();
});

test('viewer cascades protect both root and child, even when child deletion is emitted first', () => {
  const pending = new Map();
  pending.set('child', { id: 'child', inReplyToId: 'root' });
  assert.deepEqual(protectedThreadIds('child', [], pending.values()), []);
  pending.set('root', { id: 'root' });
  assert.deepEqual(protectedThreadIds('root', [], pending.values()), ['root', 'child']);
  const rows = [{ id: 'saved-reply', deleted: false, transfer: { annotation: { inReplyToId: 'root' } } }];
  assert.deepEqual(protectedThreadIds('root', rows, []), ['root', 'saved-reply']);
  assert.deepEqual(protectedThreadIds('root', [{ ...rows[0], deleted: true }], []), []);
});

test('deletion frees active quota while retained and global byte bounds remain enforced, including restores', () => {
  const { db, insert, update } = fixture();
  assert.equal(insert('one', 3, null, null, 10000, 1).changes, 1);
  assert.equal(insert('two', 3, null, null, 10000, 1).changes, 0);
  assert.equal(update('one', 1, { deleted: 1 }).changes, 1);
  assert.equal(insert('two', 3, null, null, 10000, 1).changes, 1);
  assert.equal(update('one', 2, { active: 1 }).changes, 0);
  assert.equal(insert('three', 2).changes, 0); // retained rows still have a ceiling
  const bytes = db.prepare('SELECT bytes FROM annotation_usage').get().bytes;
  assert.equal(insert('three', 10, null, null, 10000, 5, bytes).changes, 0);
  assert.equal(update('two', 1, { globalBytes: 1 }).changes, 0);
  assert.equal(update('two', 1, { deleted: 1, globalBytes: 1 }).changes, 1); // always permit cleanup
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, 4);
  db.exec("DELETE FROM embed_annotations WHERE annotation_id='one'");
  assert.equal(db.prepare('SELECT bytes FROM annotation_usage').get().bytes, 2);
  db.close();
});

test('disabled room rejects writes and joins after an earlier open read', () => {
  const { db, insert, update, join } = fixture();
  insert('one');
  db.exec("UPDATE reviews SET disabled_at='now' WHERE id='room'");
  assert.equal(insert('two').changes, 0);
  assert.equal(update('one', 1, { deleted: 1 }).changes, 0);
  assert.equal(join('new').changes, 0);
  db.close();
});

test('names use canonical keys and same-name joins are rejected in the atomic insert', () => {
  const { db, join } = fixture();
  assert.equal(participantNameKey('  Ａlice  SMITH  '), 'alice smith');
  assert.equal(join('one', 10, 'Ａlice').changes, 1);
  assert.equal(join('two', 10, 'alice').changes, 0);
  assert.equal(join('three', 10, 'OWNER').changes, 0);
  assert.equal(db.prepare("SELECT is_owner FROM participants WHERE id='one'").get().is_owner, 0);
  db.close();
});

test('canonical author labels distinguish duplicate names and owner role within PDF author limit', () => {
  const person = { id: 'abcdefghijklmnopqrstuvwx', displayName: 'A'.repeat(60), isOwner: 0 };
  const label = participantAuthorLabel(person);
  assert.ok(label.length <= 60);
  assert.ok(label.endsWith('[reviewer abcdefghijklmnopqrstuvwx]'));
  assert.notEqual(label, participantAuthorLabel({ ...person, id: 'zyxwvutsrqponmlkjihgfedcb' }));
  assert.ok(participantAuthorLabel({ ...person, isOwner: 1 }).includes('[owner '));
  const stamped = publicAnnotationRecord({ id: 'note-1', authorId: person.id, authorName: label, revision: 1, deleted: 0, transferJson: JSON.stringify({ annotation: { ...note().annotation, author: 'Old misleading name' } }), createdAt: 'now', updatedAt: 'now' }, 2);
  assert.equal(stamped.transfer.annotation.author, label);
});

test('legacy orphan replies become invalid records, while intact threads remain exportable', () => {
  const parent = publicAnnotationRecord({ id: 'note-1', authorId: 'author', authorName: 'Author', revision: 1, deleted: 0, transferJson: JSON.stringify(note()), createdAt: 'now', updatedAt: 'now' }, 2);
  const child = { ...parent, id: 'reply', transfer: { annotation: { ...note().annotation, id: 'reply', inReplyToId: 'note-1' } } };
  assert.equal(validateAnnotationThreads([parent, child])[1].invalid, undefined);
  for (const roots of [[], [{ ...parent, deleted: true, transfer: null }], [{ ...parent, invalid: true, transfer: null }]]) {
    const checked = validateAnnotationThreads([...roots, child]).at(-1);
    assert.equal(checked.invalid, true);
    assert.equal(checked.transfer, null);
  }
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
