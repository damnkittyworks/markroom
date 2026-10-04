CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`kind` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`pdf_x` real NOT NULL,
	`pdf_y` real NOT NULL,
	`pdf_width` real DEFAULT 0 NOT NULL,
	`pdf_height` real DEFAULT 0 NOT NULL,
	`color` text DEFAULT '#e8573c' NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `annotations_review_page_idx` ON `annotations` (`review_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `annotations_review_updated_idx` ON `annotations` (`review_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_review_id_idx` ON `participants` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_review_token_idx` ON `participants` (`review_id`,`token_hash`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY NOT NULL,
	`annotation_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`annotation_id`) REFERENCES `annotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `replies_annotation_id_idx` ON `replies` (`annotation_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`filename` text NOT NULL,
	`file_key` text NOT NULL,
	`file_size` integer NOT NULL,
	`page_count` integer NOT NULL,
	`owner_name` text NOT NULL,
	`owner_token_hash` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE INDEX `reviews_updated_at_idx` ON `reviews` (`updated_at`);