/** Read-only readiness probe. Migrations are exclusively an operator action. */
export const REVIEW_SCHEMA_SQL = `
SELECT version,
  (SELECT bytes FROM annotation_usage WHERE id = 1) AS usage_bytes,
  (SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN
    ('annotation_usage_insert', 'annotation_usage_update', 'annotation_usage_delete')) AS usage_triggers,
  (SELECT id || title || filename || file_key || file_size || page_count || owner_name || owner_token_hash || status || created_at || updated_at || COALESCE(closed_at, '') || COALESCE(disabled_at, '') FROM reviews WHERE 0 LIMIT 1) AS review_probe,
  (SELECT id || review_id || display_name || name_key || is_owner || token_hash || created_at || last_seen_at FROM participants WHERE 0 LIMIT 1) AS participant_probe,
  (SELECT key || annotation_id || review_id || participant_id || transfer_json || revision || deleted || created_at || updated_at FROM embed_annotations WHERE 0 LIMIT 1) AS annotation_probe,
  (SELECT review_id || file_key || file_size || created_at FROM upload_reservations WHERE 0 LIMIT 1) AS reservation_probe,
  (SELECT key || window_start || hits FROM rate_limits WHERE 0 LIMIT 1) AS rate_probe
FROM markroom_schema WHERE version = 4`;

type SchemaDatabase = {
  prepare(query: string): { first<T>(): Promise<T | null> };
};

export async function assertReviewSchema(db: SchemaDatabase) {
  const result = await db.prepare(REVIEW_SCHEMA_SQL).first<{
    version: number; usage_bytes: number | null; usage_triggers: number;
  }>();
  if (!result || result.version !== 4 || result.usage_bytes === null || result.usage_bytes < 0 || result.usage_triggers !== 3) {
    throw new Error("The required Markroom migrations are not installed.");
  }
}
