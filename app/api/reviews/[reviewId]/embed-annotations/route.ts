import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { embedAnnotations, participants, reviews } from "../../../../../db/schema";
import type { EmbedAnnotationRecord, EmbedAnnotationSnapshot } from "../../../../../lib/embed-annotation-types";
import { publicAnnotationRecord, validateEmbedTransfer, validAnnotationId, validateAnnotationThreads } from "../../../../../lib/embed-validation";
import { readJsonObject, requestFailure } from "../../../../../lib/request-validation";
import { INSERT_ANNOTATION_SQL, UPDATE_ANNOTATION_SQL, MAX_RETAINED_ANNOTATIONS, MAX_ROOM_TRANSFER_BYTES, MAX_ACTIVE_ANNOTATIONS, MAX_GLOBAL_TRANSFER_BYTES } from "../../../../../lib/review-write-sql";
import { ensureReviewSchema, findParticipant, getReviewD1, isReviewOwner, isValidReviewId, jsonError, nowIso } from "../../../../../lib/review-server";

import { enforceRateLimit } from "../../../../../lib/hosting-controls";
import { participantAuthorLabel } from "../../../../../lib/participant-label";

type RouteContext = { params: Promise<{ reviewId: string }> };
const embedKey = (reviewId: string, annotationId: string) => `${reviewId}:${annotationId}`;

async function currentRows(reviewId: string, pageCount: number): Promise<EmbedAnnotationRecord[]> {
  const rows = await getDb().select({
    id: embedAnnotations.annotationId, authorId: embedAnnotations.participantId,
    authorName: participants.displayName, authorIsOwner: participants.isOwner, revision: embedAnnotations.revision,
    deleted: embedAnnotations.deleted, transferJson: embedAnnotations.transferJson,
    createdAt: embedAnnotations.createdAt, updatedAt: embedAnnotations.updatedAt,
  }).from(embedAnnotations).innerJoin(participants, eq(embedAnnotations.participantId, participants.id))
    .where(eq(embedAnnotations.reviewId, reviewId)).orderBy(asc(embedAnnotations.createdAt));
  return validateAnnotationThreads(rows.map(({ authorIsOwner, ...row }) => publicAnnotationRecord({
    ...row, authorName: participantAuthorLabel({ id: row.authorId, displayName: row.authorName, isOwner: authorIsOwner }),
  }, pageCount)));
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    await ensureReviewSchema();
    const [review] = await getDb().select({ status: reviews.status, pageCount: reviews.pageCount }).from(reviews).where(and(eq(reviews.id, reviewId), isNull(reviews.disabledAt))).limit(1);
    if (!review) return jsonError("Review not found.", 404);
    const participant = await findParticipant(reviewId, request.headers.get("x-markroom-participant-token") ?? "");
    const payload: EmbedAnnotationSnapshot = {
      reviewStatus: review.status,
      isOwner: await isReviewOwner(reviewId, request.headers.get("x-markroom-owner-token") ?? ""),
      annotations: await currentRows(reviewId, review.pageCount),
      participant: participant ? { id: participant.id, displayName: participant.displayName, isOwner: participant.isOwner } : null,
    };
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) { return requestFailure(error, "Unable to load shared annotations."); }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    const payload = await readJsonObject(request);
    if (typeof payload.action !== "string" || !["add", "modify", "delete"].includes(payload.action)) return jsonError("Choose a valid annotation action.");
    if (!validAnnotationId(payload.annotationId)) return jsonError("The annotation identifier is invalid.");
    const annotationId = payload.annotationId;
    await ensureReviewSchema();
    const db = getDb();
    const [review] = await db.select({ status: reviews.status, pageCount: reviews.pageCount }).from(reviews).where(and(eq(reviews.id, reviewId), isNull(reviews.disabledAt))).limit(1);
    if (!review) return jsonError("Review not found.", 404);
    if (review.status === "closed") return jsonError("This review is closed.", 409);
    const participant = await findParticipant(reviewId, typeof payload.participantToken === "string" ? payload.participantToken : "");
    if (!participant) return jsonError("Join the review again before annotating.", 403);
    await enforceRateLimit(request, `write:${reviewId}`, 120, 60);
    const owner = await isReviewOwner(reviewId, typeof payload.ownerToken === "string" ? payload.ownerToken : "");
    const key = embedKey(reviewId, annotationId);
    const [existing] = await db.select().from(embedAnnotations).where(eq(embedAnnotations.key, key)).limit(1);
    if (existing && existing.participantId !== participant.id && !owner) return jsonError("You can only change your own annotations.", 403);
    if (!existing && payload.action !== "add") return jsonError("This annotation is no longer in the shared record.", 409);
    if (existing && (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision !== existing.revision)) return jsonError("This annotation changed elsewhere. Check for updates before editing it again.", 409);
    if (existing && payload.action === "add" && existing.deleted === 0) return jsonError("That annotation already exists in the shared record.", 409);
    // Keep original authorship when the owner moderates another person's mark.
    const [originalAuthor] = existing ? await db.select({ id: participants.id, displayName: participants.displayName, isOwner: participants.isOwner }).from(participants).where(eq(participants.id, existing.participantId)).limit(1) : [];
    const authorName = participantAuthorLabel(originalAuthor ?? participant);
    const transfer = payload.action === "delete" ? null : validateEmbedTransfer(payload.transfer, {
      annotationId, pageCount: review.pageCount, authorName,
    });
    if (payload.action !== "delete" && !transfer) return jsonError("This annotation contains unsupported or invalid data.");
    let parentKey: string | null = null;
    let parentRevision: number | null = null;
    if (transfer) {
      let previous = null;
      try { if (existing && existing.deleted === 0) previous = validateEmbedTransfer(JSON.parse(existing.transferJson), { annotationId, pageCount: review.pageCount }); } catch { /* Owner may replace a corrupt row with valid data. */ }
      if (previous && (previous.annotation.type !== transfer.annotation.type || previous.annotation.pageIndex !== transfer.annotation.pageIndex || previous.annotation.inReplyToId !== transfer.annotation.inReplyToId)) return jsonError("An annotation's type, page, and thread cannot be changed.");
      const parentId = transfer.annotation.inReplyToId;
      if (typeof parentId === "string") {
        parentKey = embedKey(reviewId, parentId);
        const [parent] = await db.select().from(embedAnnotations).where(and(eq(embedAnnotations.key, parentKey), eq(embedAnnotations.deleted, 0))).limit(1);
        let parentTransfer = null;
        try { if (parent) parentTransfer = validateEmbedTransfer(JSON.parse(parent.transferJson), { annotationId: parentId, pageCount: review.pageCount }); } catch { /* Reject replies to corrupt records. */ }
        if (!parent || !parentTransfer || parentTransfer.annotation.inReplyToId !== undefined || parentTransfer.annotation.pageIndex !== transfer.annotation.pageIndex) return jsonError("Reply to an existing shared comment on the same page.");
        parentRevision = parent.revision;
      }
    }
    const updatedAt = nowIso();
    const deleted = payload.action === "delete" ? 1 : 0;
    // Keep revision metadata for synchronization without retaining deleted contents.
    const transferJson = transfer ? JSON.stringify(transfer) : "{}";
    const statement = existing
      ? getReviewD1().prepare(UPDATE_ANNOTATION_SQL).bind(transferJson, deleted, updatedAt, key, reviewId, existing.revision, participant.id, owner ? 1 : 0, MAX_ROOM_TRANSFER_BYTES, parentKey, parentRevision, MAX_ACTIVE_ANNOTATIONS, MAX_GLOBAL_TRANSFER_BYTES)
      : getReviewD1().prepare(INSERT_ANNOTATION_SQL).bind(key, annotationId, reviewId, participant.id, transferJson, updatedAt, MAX_RETAINED_ANNOTATIONS, MAX_ROOM_TRANSFER_BYTES, parentKey, parentRevision, MAX_ACTIVE_ANNOTATIONS, MAX_GLOBAL_TRANSFER_BYTES);
    const result = await statement.run();
    // D1 includes the byte-accounting trigger in meta.changes. This keyed
    // statement changes at most one annotation; zero means admission failed.
    if (Number(result.meta.changes) < 1) {
      if (payload.action === "delete") {
        const child = await getReviewD1().prepare(`SELECT 1 AS found FROM embed_annotations
          WHERE review_id = ?1 AND deleted = 0
          AND CASE WHEN json_valid(transfer_json) THEN json_extract(transfer_json, '$.annotation.inReplyToId') END = ?2 LIMIT 1`).bind(reviewId, annotationId).first();
        if (child) return Response.json({ error: "This comment has replies. Keep the thread, or remove its replies before deleting the comment.", code: "thread_has_replies" }, { status: 409 });
      }
      return jsonError("The room closed, a record changed, or a review/storage limit was reached. Check for updates.", 409);
    }
    await db.update(reviews).set({ updatedAt }).where(and(eq(reviews.id, reviewId), eq(reviews.status, "open")));
    return Response.json({ annotationId, revision: existing ? existing.revision + 1 : 1, deleted: deleted === 1, updatedAt,
      transfer, authorId: existing?.participantId ?? participant.id, authorName,
    }, { status: existing ? 200 : 201 });
  } catch (error) { return requestFailure(error, "Unable to save the shared annotation."); }
}
