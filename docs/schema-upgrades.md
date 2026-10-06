# Schema upgrades

Requests only check schema readiness. They never create tables. A missing schema
returns a 503 with migration instructions; apply migrations before serving traffic.

For tracked installations, back up D1 and R2, pause writes, and apply pending
migrations using the selected deployment configuration. Fresh local development:

```sh
npm run db:migrate:local
```

Migration 0004 preserves review data, adds hosting controls, and initializes the
annotation byte counter. It does not assert an owner identity for historical
participants. Check the two-browser workflow after upgrading.

## Older automatically created schemas

Do not replay the initial CREATE TABLE migrations or change them to ignore all
existing tables. That can conceal schema drift. The offline helper below validates
an actual SQLite backup against the historical table/index/foreign-key shapes,
including the known historical timestamp-default difference:

```sh
node scripts/adopt-legacy-schema.mjs --database /path/to/backup.sqlite --output /path/to/adopt.sql
```

It opens the backup read-only and writes new guarded SQL. It never connects to
Cloudflare or applies changes. For a D1 SQL export, first import the export into
an isolated local SQLite database; keep the original backup unchanged.

Review the generated SQL. With writes paused and a fresh target backup, execute
it using `wrangler d1 execute DB --file /path/to/adopt.sql` with the appropriate
explicit **local or remote** selection and configuration. Stop on any error.
The SQL rechecks the target schema and empty migration history before recording
only migrations 0000–0002 as already represented by those tables. Then run normal
`wrangler d1 migrations apply DB` for 0003 and later migrations.

The helper refuses differing schemas and existing migration histories. Do not
force it through: those installations need a reviewed, installation-specific
adoption plan. Running migration 0003's scrub twice is harmless; it only empties
already-deleted annotation contents. Retain backups and verify live annotations
and export after adoption.

Triggers maintain `annotation_usage`; application writes enforce its bound in
the same SQL statement that changes annotations. Never remove the triggers or
reset the counter without reconciling it against stored annotation bytes.
