import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertSitesProfile, selectSitesProfile } from '../scripts/select-sites-profile.mjs';
import { standaloneMigrations } from '../scripts/migration-paths.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'markroom-profile-'));
  cpSync(standaloneMigrations, join(root, 'drizzle'), { recursive: true });
  cpSync(new URL('../drizzle-sites/', import.meta.url), join(root, 'drizzle-sites'), { recursive: true });
  mkdirSync(join(root, '.openai'));
  writeFileSync(join(root, '.openai/hosting.json'), JSON.stringify({ project_id: 'synthetic-local', d1: 'DB', r2: 'FILES' }));
  return root;
}

test('Sites source selection preserves standalone history and excludes it from the packaged root', () => {
  const root = fixture();
  try {
    const before = readFileSync(join(root, 'drizzle/0004_hosting_controls.sql'));
    assert.throws(() => assertSitesProfile(root), /schema-only profile/);
    selectSitesProfile(root);
    assert.deepEqual(readFileSync(join(root, 'drizzle-standalone/0004_hosting_controls.sql')), before);
    assert.equal(existsSync(join(root, 'drizzle/0004_hosting_controls.sql')), false);
    assertSitesProfile(root);
    selectSitesProfile(root); // retry is a no-op
    writeFileSync(join(root, 'drizzle/unexpected.sql'), 'SELECT 1;');
    assert.throws(() => selectSitesProfile(root), /schema-only profile/);
    assert.equal(existsSync(join(root, 'drizzle/unexpected.sql')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a changed historical baseline is rejected before moving directories', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'drizzle/0000_romantic_stone_men.sql'), 'changed');
    assert.throws(() => selectSitesProfile(root), /Historical migration mismatch/);
    assert.equal(existsSync(join(root, 'drizzle-standalone')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
