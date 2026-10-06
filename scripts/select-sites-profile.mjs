#!/usr/bin/env node
import { cpSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Migration profiles must not contain symlinks.');
    return entry.isDirectory() ? files(directory, name) : [name];
  }).sort();
}

export function assertSitesProfile(root) {
  const selected = join(root, 'drizzle');
  const profile = join(root, 'drizzle-sites');
  const expected = files(profile);
  if (JSON.stringify(files(selected)) !== JSON.stringify(expected) || expected.some(name => !readFileSync(join(selected, name)).equals(readFileSync(join(profile, name))))) {
    throw new Error('Sites packaging requires the exact schema-only profile in drizzle. Run node scripts/select-sites-profile.mjs in the Sites checkout before building.');
  }
}

export function selectSitesProfile(root) {
  const hosting = JSON.parse(readFileSync(join(root, '.openai/hosting.json'), 'utf8'));
  if (!hosting.project_id || hosting.d1 !== 'DB' || hosting.r2 !== 'FILES') throw new Error('Preserve the existing Markroom Sites identity and DB/FILES bindings.');
  const backup = join(root, 'drizzle-standalone');
  if (existsSync(backup)) {
    assertSitesProfile(root);
    return;
  }
  const selected = join(root, 'drizzle');
  const baseline = ['0000_romantic_stone_men', '0001_secret_doctor_strange', '0002_acoustic_bedlam'];
  for (const name of baseline) {
    if (!readFileSync(join(selected, `${name}.sql`)).equals(readFileSync(join(root, 'drizzle-sites', `${name}.sql`)))) throw new Error('Historical migration mismatch; refusing to change profiles.');
  }
  const journal = JSON.parse(readFileSync(join(selected, 'meta/_journal.json'), 'utf8'));
  if (journal.entries.at(-1)?.tag !== '0004_hosting_controls') throw new Error('Unrecognized migration lineage; inspect it before selecting Sites.');
  renameSync(selected, backup);
  try { cpSync(join(root, 'drizzle-sites'), selected, { recursive: true }); }
  catch (error) { throw new Error(`Profile copy failed. Standalone source is preserved in drizzle-standalone: ${error.message}`); }
  assertSitesProfile(root);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  selectSitesProfile(process.cwd());
  process.stdout.write('Selected the Sites migration profile; standalone migrations are preserved.\n');
}
