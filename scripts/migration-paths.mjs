import { existsSync } from 'node:fs';

// A Sites source checkout retains the standalone lineage for tests and tools.
const retained = new URL('../drizzle-standalone/', import.meta.url);
export const standaloneMigrations = existsSync(retained) ? retained : new URL('../drizzle/', import.meta.url);
