import { requireOperator } from "../../../../../lib/hosting-controls";
import { ensureReviewSchema, getReviewD1, getReviewFiles, isValidReviewId, jsonError, nowIso } from "../../../../../lib/review-server";
import { requestFailure } from "../../../../../lib/request-validation";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await requireOperator(request);
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    await ensureReviewSchema();
    const db = getReviewD1();
    // Deny further reads/writes before storage cleanup. A failed cleanup remains
    // disabled and counted, and the operator can safely retry this operation.
    await db.prepare("UPDATE reviews SET disabled_at=COALESCE(disabled_at,?1), status='closed' WHERE id=?2").bind(nowIso(), reviewId).run();
    const review = await db.prepare("SELECT file_key FROM reviews WHERE id=?1").bind(reviewId).first<{ file_key: string }>();
    if (!review) return new Response(null, { status: 204 });
    await getReviewFiles().delete(review.file_key);
    await db.batch([
      db.prepare("DELETE FROM replies WHERE annotation_id IN (SELECT id FROM annotations WHERE review_id=?1)").bind(reviewId),
      ...["embed_annotations", "native_annotations", "annotations", "participants", "reviews"].map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE ${table === "reviews" ? "id" : "review_id"}=?1`).bind(reviewId)),
    ]);
    return new Response(null, { status: 204 });
  } catch (error) { return requestFailure(error, "Takedown cleanup failed. The room remains disabled; retry to finish deleting it."); }
}
