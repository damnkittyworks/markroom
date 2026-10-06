import { requireOperator } from "../../../../lib/hosting-controls";
import { ensureReviewSchema, getReviewD1 } from "../../../../lib/review-server";
import { requestFailure } from "../../../../lib/request-validation";

export async function GET(request: Request) {
  try {
    await requireOperator(request);
    await ensureReviewSchema();
    const db = getReviewD1();
    const [reviews, reservations, usage] = await Promise.all([
      db.prepare("SELECT id,title,file_size,created_at,disabled_at FROM reviews ORDER BY created_at DESC LIMIT 1000").all(),
      db.prepare("SELECT review_id,file_size,created_at FROM upload_reservations ORDER BY created_at LIMIT 1000").all(),
      db.prepare("SELECT bytes FROM annotation_usage WHERE id=1").first(),
    ]);
    return Response.json({ reviews: reviews.results, reservations: reservations.results, annotationUsage: usage }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return requestFailure(error, "Unable to inspect hosting usage."); }
}
