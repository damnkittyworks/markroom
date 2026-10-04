CREATE TABLE `embed_annotations` (
	`key` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`review_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`transfer_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embed_annotations_review_annotation_idx` ON `embed_annotations` (`review_id`,`annotation_id`);--> statement-breakpoint
CREATE INDEX `embed_annotations_review_updated_idx` ON `embed_annotations` (`review_id`,`updated_at`);