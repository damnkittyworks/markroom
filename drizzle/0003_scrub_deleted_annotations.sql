-- Keep revision tombstones for synchronization, but erase previously deleted contents.
UPDATE embed_annotations SET transfer_json = '{}' WHERE deleted = 1;
