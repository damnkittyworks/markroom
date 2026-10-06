ALTER TABLE reviews ADD COLUMN disabled_at TEXT;
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN name_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE participants ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Historical names have no verified owner identity. Do not infer roles from names.
-- SQLite's baseline normalization is ASCII-only; runtime joins also compare the
-- NFKC-normalized display names of existing participants.
UPDATE participants SET name_key = lower(trim(display_name));
--> statement-breakpoint
CREATE TABLE upload_reservations (
  review_id TEXT PRIMARY KEY NOT NULL,
  file_key TEXT NOT NULL,
  file_size INTEGER NOT NULL CONSTRAINT upload_reservations_nonnegative CHECK (file_size >= 0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX upload_reservations_file_key_unique ON upload_reservations (file_key);
--> statement-breakpoint
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE annotation_usage (
  id INTEGER PRIMARY KEY NOT NULL CONSTRAINT annotation_usage_singleton CHECK (id = 1),
  bytes INTEGER NOT NULL CONSTRAINT annotation_usage_nonnegative CHECK (bytes >= 0)
);
--> statement-breakpoint
INSERT INTO annotation_usage (id, bytes)
SELECT 1, COALESCE(SUM(length(CAST(transfer_json AS BLOB))), 0) FROM embed_annotations;
--> statement-breakpoint
CREATE TRIGGER annotation_usage_insert AFTER INSERT ON embed_annotations
BEGIN
  UPDATE annotation_usage SET bytes = bytes + length(CAST(NEW.transfer_json AS BLOB)) WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER annotation_usage_update AFTER UPDATE OF transfer_json ON embed_annotations
BEGIN
  UPDATE annotation_usage SET bytes = bytes - length(CAST(OLD.transfer_json AS BLOB)) + length(CAST(NEW.transfer_json AS BLOB)) WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER annotation_usage_delete AFTER DELETE ON embed_annotations
BEGIN
  UPDATE annotation_usage SET bytes = bytes - length(CAST(OLD.transfer_json AS BLOB)) WHERE id = 1;
END;
--> statement-breakpoint
CREATE TABLE markroom_schema (version INTEGER PRIMARY KEY NOT NULL);
--> statement-breakpoint
INSERT INTO markroom_schema (version) VALUES (4);
