import { RequestError } from "./request-validation";
import { assertReviewSchema, REVIEW_SCHEMA_SQL } from "./review-schema";

const notInitialized = "NOT EXISTS (SELECT 1 FROM markroom_schema WHERE version = 4)";

// Each statement is conditional at execution time, not only after a prior read.
// Reconcile before scrubbing: an uninitialized, stale counter must not make the
// deletion triggers subtract from zero. D1 batch commits all three or none.
export const INITIALIZE_REVIEW_DATA_SQL = [
  `INSERT INTO annotation_usage (id, bytes)
   SELECT 1, COALESCE((SELECT SUM(length(CAST(transfer_json AS BLOB))) FROM embed_annotations), 0)
   WHERE ${notInitialized}
   ON CONFLICT(id) DO UPDATE SET bytes = excluded.bytes`,
  `UPDATE embed_annotations SET transfer_json = '{}'
   WHERE deleted = 1 AND transfer_json <> '{}' AND ${notInitialized}`,
  `INSERT INTO markroom_schema (version) SELECT 4 WHERE ${notInitialized}`,
] as const;

/** Explicit operator maintenance only; ordinary request readiness stays read-only. */
export async function initializeReviewData(db: D1Database): Promise<"initialized" | "alreadyReady"> {
  let ready: unknown;
  try {
    // Preparing this read-only probe verifies every required table/column even
    // when the marker row is absent. Initialization never creates schema.
    ready = await db.prepare(REVIEW_SCHEMA_SQL).first();
    const triggers = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'trigger' AND name IN
      ('annotation_usage_insert', 'annotation_usage_update', 'annotation_usage_delete')`).first<{ count: number }>();
    if (triggers?.count !== 3) throw new Error("Accounting triggers are missing.");
    if (ready) await assertReviewSchema(db);
  } catch {
    throw new RequestError("Apply the required schema migrations before initializing review data.", 503);
  }
  if (ready) return "alreadyReady";

  const results = await db.batch(INITIALIZE_REVIEW_DATA_SQL.map((sql) => db.prepare(sql)));
  await assertReviewSchema(db);
  // A concurrent initializer may have committed after our initial read.
  return results[results.length - 1].meta.changes === 1 ? "initialized" : "alreadyReady";
}
