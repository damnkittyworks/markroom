import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    fileKey: text("file_key").notNull(),
    fileSize: integer("file_size").notNull(),
    pageCount: integer("page_count").notNull(),
    ownerName: text("owner_name").notNull(),
    ownerTokenHash: text("owner_token_hash").notNull(),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    closedAt: text("closed_at"),
  },
  (table) => [index("reviews_updated_at_idx").on(table.updatedAt)],
);

export const participants = sqliteTable(
  "participants",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("participants_review_id_idx").on(table.reviewId),
    uniqueIndex("participants_review_token_idx").on(
      table.reviewId,
      table.tokenHash,
    ),
  ],
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    pageNumber: integer("page_number").notNull(),
    kind: text("kind", { enum: ["pin", "area"] }).notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    width: real("width").notNull().default(0),
    height: real("height").notNull().default(0),
    pdfX: real("pdf_x").notNull(),
    pdfY: real("pdf_y").notNull(),
    pdfWidth: real("pdf_width").notNull().default(0),
    pdfHeight: real("pdf_height").notNull().default(0),
    color: text("color").notNull().default("#e8573c"),
    body: text("body").notNull(),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("annotations_review_page_idx").on(table.reviewId, table.pageNumber),
    index("annotations_review_updated_idx").on(table.reviewId, table.updatedAt),
  ],
);

// Retained to preserve records from the retired viewer experiment and to stop
// Drizzle from proposing a destructive DROP TABLE migration.
export const nativeAnnotations = sqliteTable(
  "native_annotations",
  {
    key: text("key").primaryKey(),
    annotationId: text("annotation_id").notNull(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    xfdf: text("xfdf").notNull(),
    revision: integer("revision").notNull().default(1),
    deleted: integer("deleted").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("native_annotations_review_annotation_idx").on(
      table.reviewId,
      table.annotationId,
    ),
    index("native_annotations_review_updated_idx").on(
      table.reviewId,
      table.updatedAt,
    ),
  ],
);

export const embedAnnotations = sqliteTable(
  "embed_annotations",
  {
    key: text("key").primaryKey(),
    annotationId: text("annotation_id").notNull(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    transferJson: text("transfer_json").notNull(),
    revision: integer("revision").notNull().default(1),
    deleted: integer("deleted").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("embed_annotations_review_annotation_idx").on(
      table.reviewId,
      table.annotationId,
    ),
    index("embed_annotations_review_updated_idx").on(
      table.reviewId,
      table.updatedAt,
    ),
  ],
);

export const replies = sqliteTable(
  "replies",
  {
    id: text("id").primaryKey(),
    annotationId: text("annotation_id")
      .notNull()
      .references(() => annotations.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("replies_annotation_id_idx").on(table.annotationId)],
);
