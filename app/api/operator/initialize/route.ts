import { requireOperator } from "../../../../lib/hosting-controls";
import { initializeReviewData } from "../../../../lib/review-initialization";
import { getReviewD1 } from "../../../../lib/review-server";
import { requestFailure } from "../../../../lib/request-validation";

export async function POST(request: Request) {
  try {
    await requireOperator(request);
    const status = await initializeReviewData(getReviewD1());
    return Response.json({ status }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return requestFailure(error, "Review data initialization could not be confirmed. Check the database and retry this operation safely.");
  }
}
