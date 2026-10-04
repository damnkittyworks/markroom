import { eq } from "drizzle-orm";
import { readJsonObject, requestFailure } from "../../../../lib/request-validation";
import { getDb } from "../../../../db";
import { reviews } from "../../../../db/schema";
import {
  ensureReviewSchema,
  getReviewSnapshot,
  isReviewOwner,
  isValidReviewId,
  jsonError,
  nowIso,
} from "../../../../lib/review-server";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    const snapshot = await getReviewSnapshot(reviewId);
    if (!snapshot) return jsonError("Review not found.", 404);
    return Response.json(snapshot, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return requestFailure(error, "Unable to load the review.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    const payload = await readJsonObject(request, 4096);
    if (payload.action !== "close") return jsonError("Unsupported review action.");
    await ensureReviewSchema();
    if (!(await isReviewOwner(reviewId, typeof payload.ownerToken === "string" ? payload.ownerToken : ""))) {
      return jsonError("Only the review initiator can close this room.", 403);
    }
    const db = getDb();
    const updatedAt = nowIso();
    await db
      .update(reviews)
      .set({ status: "closed", closedAt: updatedAt, updatedAt })
      .where(eq(reviews.id, reviewId));
    return Response.json({ status: "closed", updatedAt });
  } catch (error) {
    return requestFailure(error, "Unable to update the review.");
  }
}
