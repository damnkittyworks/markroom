import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { reviews } from "../../../../../db/schema";
import { requestFailure } from "../../../../../lib/request-validation";
import {
  ensureReviewSchema,
  getReviewFiles,
  isValidReviewId,
  jsonError,
} from "../../../../../lib/review-server";

type RouteContext = { params: Promise<{ reviewId: string }> };

function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return null;
  if (!startText) {
    const suffix = Math.min(Number(endText), size);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { offset: size - suffix, length: suffix };
  }
  const offset = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(offset) || !Number.isInteger(requestedEnd) || offset < 0 || offset >= size) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

async function getFileResponse(request: Request, context: RouteContext, head = false) {
  try {
    const { reviewId } = await context.params;
    if (!isValidReviewId(reviewId)) return jsonError("Review not found.", 404);
    await ensureReviewSchema();
    const db = getDb();
    const [review] = await db
      .select({
        fileKey: reviews.fileKey,
        filename: reviews.filename,
      })
      .from(reviews)
      .where(and(eq(reviews.id, reviewId), isNull(reviews.disabledAt)))
      .limit(1);
    if (!review) return jsonError("Review not found.", 404);

    const bucket = getReviewFiles();
    const metadata = await bucket.head(review.fileKey);
    if (!metadata) return jsonError("PDF file not found.", 404);
    const fileSize = metadata.size;
    const rangeHeader = request.headers.get("range");
    const range = parseRange(rangeHeader, fileSize);
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${fileSize}` },
      });
    }
    const object = head ? null : await bucket.get(
      review.fileKey,
      range ? { range } : undefined,
    );
    if (!head && !object) return jsonError("PDF file not found.", 404);
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-type": "application/pdf",
      etag: metadata.httpEtag,
      "x-content-type-options": "nosniff",
    });
    if (range) {
      headers.set("content-length", String(range.length));
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${fileSize}`,
      );
    } else {
      headers.set("content-length", String(fileSize));
    }
    return new Response(object?.body ?? null, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return requestFailure(error, "Unable to load the PDF.");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return getFileResponse(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return getFileResponse(request, context, true);
}
