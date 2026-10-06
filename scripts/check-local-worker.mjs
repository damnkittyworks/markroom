// Synthetic end-to-end API check, deliberately restricted to a localhost preview.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
const origin = process.env.MARKROOM_TEST_ORIGIN || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('This check runs on localhost only.');
const creator = process.env.MARKROOM_TEST_CREATION_KEY || 'local-test-creation-key-not-for-production-0001';
const operator = process.env.MARKROOM_TEST_OPERATOR_KEY || 'local-test-operator-key-not-for-production-0001';
const bytes = await readFile(new URL('../examples/markroom-sample.pdf', import.meta.url));
async function call(path, options = {}) {
  // Use a separate connection for every request, including rejected uploads.
  return new Promise((resolve, reject) => {
    const url = new URL(origin + path);
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: options.method ?? 'GET', headers: options.headers, agent: false,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        console.log(`${options.method ?? 'GET'} ${path}: ${response.statusCode}`);
        const text = Buffer.concat(chunks).toString('utf8');
        let data; try { data = JSON.parse(text); } catch { data = text; }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        resolve({ response: { status: response.statusCode, headers }, data });
      });
    });
    request.on('error', reject);
    request.setTimeout(45000, () => request.destroy(new Error(`Local Worker request timed out: ${options.method ?? 'GET'} ${path}`)));
    request.end(options.body);
  });
}
const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const headers = { 'content-type': 'application/pdf', 'x-file-name': 'sample.pdf', 'x-file-size': String(bytes.length), 'x-page-count': '2', 'x-reviewer-name': 'API Owner' };
assert.equal((await call('/api/reviews', { method: 'POST' })).response.status, 403);
assert.equal((await call('/api/operator/reviews')).response.status, 403);
const inspection = () => call('/api/operator/reviews', { headers: { authorization: `Bearer ${operator}` } });
const beforeInvalid = (await inspection()).data;
const invalid = await call('/api/reviews', { method: 'POST', headers: { ...headers, 'x-file-size': '9', 'x-markroom-creation-key': creator }, body: 'not a pdf' });
assert.equal(invalid.response.status, 415); // invalid signature after reservation must release storage budget
const afterInvalid = (await inspection()).data;
assert.equal(afterInvalid.reviews.length, beforeInvalid.reviews.length);
assert.equal(afterInvalid.reservations.length, beforeInvalid.reservations.length);
const created = await call('/api/reviews', { method: 'POST', headers: { ...headers, 'x-markroom-creation-key': creator }, body: bytes });
assert.equal(created.response.status, 201, JSON.stringify(created.data));
const { reviewId, ownerToken, participantToken } = created.data;
const path = `/api/reviews/${reviewId}`;
try {
  assert.equal((await call(path + '/participants', json({ displayName: 'ＡＰＩ Owner' }))).response.status, 409);
  const joined = await call(path + '/participants', json({ displayName: 'API Reviewer' }));
  assert.equal(joined.response.status, 201, JSON.stringify(joined.data));
  const session = await call(path + '/embed-annotations', { headers: { 'x-markroom-owner-token': ownerToken, 'x-markroom-participant-token': participantToken } });
  assert.equal(session.data.isOwner, true);
  assert.equal(session.data.participant.isOwner, true);
  const forged = await call(path + '/embed-annotations', { headers: { 'x-markroom-owner-token': 'made-up-key' } });
  assert.equal(forged.data.isOwner, false);
  const note = (id, contents, parent) => ({ annotation: { id, type: 1, pageIndex: 0, rect: { origin: { x: 100, y: 100 }, size: { width: 24, height: 24 } }, contents, created: '2026-10-05T12:00:00Z', flags: ['print'], ...(parent ? { inReplyToId: parent, replyType: 1 } : {}) } });
  const add = await call(path + '/embed-annotations', json({ action: 'add', annotationId: 'api-root', participantToken, transfer: note('api-root', 'Synthetic parent') }));
  assert.equal(add.response.status, 201, JSON.stringify(add.data));
  assert.match(add.data.transfer.annotation.author, /\[owner /);
  const reply = await call(path + '/embed-annotations', json({ action: 'add', annotationId: 'api-reply', participantToken: joined.data.participantToken, transfer: note('api-reply', 'Synthetic reply', 'api-root') }));
  assert.equal(reply.response.status, 201, JSON.stringify(reply.data));
  const blocked = await call(path + '/embed-annotations', json({ action: 'delete', annotationId: 'api-root', expectedRevision: 1, participantToken }));
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.data.code, 'thread_has_replies');
  const rows = await call(path + '/embed-annotations');
  assert.equal(rows.data.annotations.filter(row => !row.deleted).length, 2);
  const file = await fetch(origin + path + '/file');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(file.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  const html = await call(`/review/${reviewId}`);
  assert.match(html.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(html.response.headers.get('referrer-policy'), 'no-referrer');
  const nonce = html.response.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
  assert.ok([...html.data.matchAll(/<script\b[^>]*>/g)].every(match => match[0].includes(`nonce="${nonce}"`)));
  for (let i = 0; i < 9; i++) {
    const repeated = await call(path + '/participants', json({ displayName: 'API Reviewer' }));
    assert.equal(repeated.response.status, i < 8 ? 409 : 429);
  }
  const close = await call(path, { ...json({ action: 'close', ownerToken }), method: 'PATCH' });
  assert.equal(close.response.status, 200);
  assert.equal((await call(path + '/participants', json({ displayName: 'Late reviewer' }))).response.status, 409);
  assert.equal((await call(path + '/embed-annotations', json({ action: 'delete', annotationId: 'api-reply', expectedRevision: 1, participantToken: joined.data.participantToken }))).response.status, 409);
  console.log('PASS: key gating, normalized names, verified roles, real D1 saves, thread preservation, original bytes, HTML nonces, closing.');
} finally {
  const deleted = await call(`/api/operator/reviews/${reviewId}`, { method: 'DELETE', headers: { authorization: `Bearer ${operator}` } });
  assert.equal(deleted.response.status, 204, JSON.stringify(deleted.data));
  for (const suffix of ['', '/file', '/embed-annotations']) assert.equal((await call(path + suffix)).response.status, 404);
  assert.equal((await fetch(origin + path + '/file', { method: 'HEAD' })).status, 404);
  assert.equal((await fetch(origin + path + '/file', { headers: { range: 'bytes=0-7' } })).status, 404);
  console.log('PASS: operator takedown removes review, annotations, original, HEAD and range access.');
}
assert.equal((await call('/api/reviews', { method: 'POST', headers, body: bytes })).response.status, 403);
console.log('PASS: unauthenticated PDF body is rejected.');
