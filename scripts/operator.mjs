#!/usr/bin/env node
// Explicit operator actions only. No keys in URLs, command arguments, or output.
const [base, action, reviewId, confirmation] = process.argv.slice(2);
try {
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, except for a localhost test.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Supply only the site origin.');
  if (!['list', 'delete'].includes(action)) throw new Error('Usage: node scripts/operator.mjs https://your-site.example list | delete ROOM_ID --confirm');
  const key = process.env.MARKROOM_OPERATOR_KEY;
  if (!key || key.length < 32 || key.length > 256) throw new Error('Set MARKROOM_OPERATOR_KEY in the process environment using your secret manager.');
  if (action === 'delete' && (!/^[A-Za-z0-9_-]{16,32}$/.test(reviewId ?? '') || confirmation !== '--confirm')) throw new Error('Deletion requires an exact room ID and --confirm. It cannot be undone by Markroom.');
  const path = action === 'list' ? '/api/operator/reviews' : `/api/operator/reviews/${reviewId}`;
  const response = await fetch(new URL(path, url), {
    method: action === 'list' ? 'GET' : 'DELETE',
    headers: { authorization: `Bearer ${key}` },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Operator request failed (${response.status}): ${(await response.json()).error ?? 'Unknown error'}`);
  if (action === 'list') process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
  else process.stdout.write('Room unavailable; application records and stored PDF deleted. Previously downloaded copies and backups are unaffected.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
