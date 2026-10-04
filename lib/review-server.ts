import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { annotations, participants, replies, reviews } from "../db/schema";
import type {
  AnnotationDraft,
  ReviewAnnotation,
  ReviewSnapshot,
} from "./review-types";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_PAGE_COUNT = 1000;
export const MAX_COMMENT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 60;
export const MAX_TITLE_LENGTH = 120;

type ReviewFileObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
};

type ReviewFileBucket = {
  put(
    key: string,
    value: ReadableStream<Uint8Array>,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<ReviewFileObject | null>;
  head(key: string): Promise<Omit<ReviewFileObject, "body"> | null>;
  delete(key: string): Promise<void>;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_key TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    owner_name TEXT NOT NULL,
    owner_token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS reviews_updated_at_idx ON reviews (updated_at)`,
  `CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY NOT NULL,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS participants_review_id_idx ON participants (review_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS participants_review_token_idx ON participants (review_id, token_hash)`,
  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY NOT NULL,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    page_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL DEFAULT 0,
    height REAL NOT NULL DEFAULT 0,
    pdf_x REAL NOT NULL,
    pdf_y REAL NOT NULL,
    pdf_width REAL NOT NULL DEFAULT 0,
    pdf_height REAL NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#e8573c',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS annotations_review_page_idx ON annotations (review_id, page_number)`,
  `CREATE INDEX IF NOT EXISTS annotations_review_updated_idx ON annotations (review_id, updated_at)`,
  // Historical table retained so existing experimental records are not destroyed.
  `CREATE TABLE IF NOT EXISTS native_annotations (
    key TEXT PRIMARY KEY NOT NULL,
    annotation_id TEXT NOT NULL,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    xfdf TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS native_annotations_review_annotation_idx ON native_annotations (review_id, annotation_id)`,
  `CREATE INDEX IF NOT EXISTS native_annotations_review_updated_idx ON native_annotations (review_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS embed_annotations (
    key TEXT PRIMARY KEY NOT NULL,
    annotation_id TEXT NOT NULL,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    transfer_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS embed_annotations_review_annotation_idx ON embed_annotations (review_id, annotation_id)`,
  `CREATE INDEX IF NOT EXISTS embed_annotations_review_updated_idx ON embed_annotations (review_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY NOT NULL,
    annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS replies_annotation_id_idx ON replies (annotation_id)`,
];

let schemaReady: Promise<void> | null = null;

export function getReviewD1() { return env.DB; }

export function getReviewFiles() {
  const bucket = (env as unknown as { FILES?: ReviewFileBucket }).FILES;
  if (!bucket) {
    throw new Error("The review file store is unavailable.");
  }
  return bucket;
}

export async function ensureReviewSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const d1 = env.DB;
      await d1.batch(schemaStatements.map((statement) => d1.prepare(statement)));
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

export function cleanParagraph(value: unknown, maxLength = MAX_COMMENT_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function isValidReviewId(value: string) {
  return /^[A-Za-z0-9_-]{16,32}$/.test(value);
}

export function makeId(byteLength = 18) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function nowIso() {
  return new Date().toISOString();
}

export function fileKeyForReview(reviewId: string) {
  return `reviews/${reviewId}/original.pdf`;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function findParticipant(reviewId: string, rawToken: string) {
  const token = cleanText(rawToken, 180);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const db = getDb();
  const [participant] = await db
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.reviewId, reviewId),
        eq(participants.tokenHash, tokenHash),
      ),
    )
    .limit(1);
  return participant ?? null;
}

export async function isReviewOwner(reviewId: string, rawToken: string) {
  const token = cleanText(rawToken, 180);
  if (!token) return false;
  const tokenHash = await hashToken(token);
  const db = getDb();
  const [review] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(eq(reviews.id, reviewId), eq(reviews.ownerTokenHash, tokenHash)),
    )
    .limit(1);
  return Boolean(review);
}

export function validNormalizedNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateAnnotationDraft(
  value: Partial<AnnotationDraft>,
  pageCount: number,
): { value?: AnnotationDraft; error?: string } {
  const pageNumber = Number(value.pageNumber);
  const kind = value.kind;
  const body = cleanParagraph(value.body);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
    return { error: "Choose a valid page." };
  }
  if (kind !== "pin" && kind !== "area") {
    return { error: "Choose a valid annotation tool." };
  }
  if (!body) return { error: "Write a comment before posting." };

  const numbers = [
    value.x,
    value.y,
    value.width,
    value.height,
    value.pdfX,
    value.pdfY,
    value.pdfWidth,
    value.pdfHeight,
  ];
  if (!numbers.every(validNormalizedNumber)) {
    return { error: "The annotation position is invalid." };
  }
  if (kind === "area" && (Number(value.width) < 0.005 || Number(value.height) < 0.005)) {
    return { error: "Drag a larger review area." };
  }
  const color = typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
    ? value.color
    : "#e8573c";

  return {
    value: {
      pageNumber,
      kind,
      x: Number(value.x),
      y: Number(value.y),
      width: Number(value.width),
      height: Number(value.height),
      pdfX: Number(value.pdfX),
      pdfY: Number(value.pdfY),
      pdfWidth: Number(value.pdfWidth),
      pdfHeight: Number(value.pdfHeight),
      color,
      body,
    },
  };
}

export async function getReviewSnapshot(reviewId: string): Promise<ReviewSnapshot | null> {
  await ensureReviewSchema();
  const db = getDb();
  const [reviewRow] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  if (!reviewRow) return null;

  const [participantRows, annotationRows, replyRows] = await Promise.all([
    db
      .select({
        id: participants.id,
        displayName: participants.displayName,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .where(eq(participants.reviewId, reviewId))
      .orderBy(asc(participants.createdAt)),
    db
      .select({
        id: annotations.id,
        pageNumber: annotations.pageNumber,
        kind: annotations.kind,
        x: annotations.x,
        y: annotations.y,
        width: annotations.width,
        height: annotations.height,
        pdfX: annotations.pdfX,
        pdfY: annotations.pdfY,
        pdfWidth: annotations.pdfWidth,
        pdfHeight: annotations.pdfHeight,
        color: annotations.color,
        body: annotations.body,
        status: annotations.status,
        authorName: participants.displayName,
        createdAt: annotations.createdAt,
        updatedAt: annotations.updatedAt,
      })
      .from(annotations)
      .innerJoin(participants, eq(annotations.participantId, participants.id))
      .where(eq(annotations.reviewId, reviewId))
      .orderBy(asc(annotations.createdAt)),
    db
      .select({
        id: replies.id,
        annotationId: replies.annotationId,
        authorName: participants.displayName,
        body: replies.body,
        createdAt: replies.createdAt,
      })
      .from(replies)
      .innerJoin(participants, eq(replies.participantId, participants.id))
      .innerJoin(annotations, eq(replies.annotationId, annotations.id))
      .where(eq(annotations.reviewId, reviewId))
      .orderBy(asc(replies.createdAt)),
  ]);

  const repliesByAnnotation = new Map<string, typeof replyRows>();
  for (const reply of replyRows) {
    const list = repliesByAnnotation.get(reply.annotationId) ?? [];
    list.push(reply);
    repliesByAnnotation.set(reply.annotationId, list);
  }

  const annotationSnapshot: ReviewAnnotation[] = annotationRows.map((annotation) => ({
    ...annotation,
    replies: repliesByAnnotation.get(annotation.id) ?? [],
  }));

  return {
    review: {
      id: reviewRow.id,
      title: reviewRow.title,
      filename: reviewRow.filename,
      fileSize: reviewRow.fileSize,
      pageCount: reviewRow.pageCount,
      ownerName: reviewRow.ownerName,
      status: reviewRow.status,
      createdAt: reviewRow.createdAt,
      updatedAt: reviewRow.updatedAt,
      closedAt: reviewRow.closedAt,
    },
    participants: participantRows,
    annotations: annotationSnapshot,
  };
}
