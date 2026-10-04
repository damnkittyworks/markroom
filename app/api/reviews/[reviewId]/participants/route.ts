import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { reviews } from "../../../../../db/schema";
import { cleanText, ensureReviewSchema, getReviewD1, hashToken, isValidReviewId, jsonError, makeId, MAX_NAME_LENGTH, nowIso } from "../../../../../lib/review-server";
import { readJsonObject, requestFailure } from "../../../../../lib/request-validation";
import { INSERT_PARTICIPANT_SQL } from "../../../../../lib/review-write-sql";
const MAX_PARTICIPANTS = 100;
type RouteContext = { params: Promise<{ reviewId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    const payload = await readJsonObject(request, 4096);
    if (typeof payload.displayName !== "string" || payload.displayName.length > MAX_NAME_LENGTH) return jsonError("Enter a name of up to 60 characters.");
    const displayName = cleanText(payload.displayName, MAX_NAME_LENGTH);
    if (!displayName) return jsonError("Enter the name other reviewers will see.");
    await ensureReviewSchema();
    const [review] = await getDb().select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewId)).limit(1);
    if (!review) return jsonError("Review not found.", 404);
    if (review.status === "closed") return jsonError("This review is closed. You can still read its comments.", 409);
    const participantToken = makeId(32);
    const participantId = makeId(18);
    const createdAt = nowIso();
    const result = await getReviewD1().prepare(INSERT_PARTICIPANT_SQL).bind(participantId, reviewId, displayName, await hashToken(participantToken), createdAt, MAX_PARTICIPANTS).run();
    if (result.meta.changes !== 1) return jsonError("This review closed or already has 100 participants.", 409);
    return Response.json({ participantId, participantToken, displayName }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return requestFailure(error, "Unable to join the review."); }
}
