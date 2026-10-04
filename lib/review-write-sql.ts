// D1 executes each conditional statement atomically. Checks must live in the
// write, not only a preceding SELECT, so a completed close wins over later writes.
export const MAX_RETAINED_ANNOTATIONS = 5000;
export const MAX_ROOM_TRANSFER_BYTES = 16 * 1024 * 1024;
export const INSERT_ANNOTATION_SQL = `
INSERT INTO embed_annotations (key, annotation_id, review_id, participant_id, transfer_json, revision, deleted, created_at, updated_at)
SELECT ?1, ?2, ?3, ?4, ?5, 1, 0, ?6, ?6
WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ?3 AND status = 'open')
AND (SELECT COUNT(*) FROM embed_annotations WHERE review_id = ?3) < ?7
AND (SELECT COALESCE(SUM(length(CAST(transfer_json AS BLOB))), 0) FROM embed_annotations WHERE review_id = ?3) + length(CAST(?5 AS BLOB)) <= ?8
AND (?9 IS NULL OR EXISTS (SELECT 1 FROM embed_annotations WHERE key = ?9 AND review_id = ?3 AND deleted = 0 AND revision = ?10))
ON CONFLICT(key) DO NOTHING`;

export const UPDATE_ANNOTATION_SQL = `
UPDATE embed_annotations SET transfer_json = ?1, revision = revision + 1, deleted = ?2, updated_at = ?3
WHERE key = ?4 AND review_id = ?5 AND revision = ?6
AND (participant_id = ?7 OR ?8 = 1)
AND EXISTS (SELECT 1 FROM reviews WHERE id = ?5 AND status = 'open')
AND (?2 = 1 OR (SELECT COALESCE(SUM(length(CAST(transfer_json AS BLOB))), 0) FROM embed_annotations WHERE review_id = ?5) - length(CAST(transfer_json AS BLOB)) + length(CAST(?1 AS BLOB)) <= ?9)
AND (?10 IS NULL OR EXISTS (SELECT 1 FROM embed_annotations AS parent WHERE parent.key = ?10 AND parent.review_id = ?5 AND parent.deleted = 0 AND parent.revision = ?11))`;

export const INSERT_PARTICIPANT_SQL = `
INSERT INTO participants (id, review_id, display_name, token_hash, created_at, last_seen_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?5
WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ?2 AND status = 'open')
AND (SELECT COUNT(*) FROM participants WHERE review_id = ?2) < ?6`;
