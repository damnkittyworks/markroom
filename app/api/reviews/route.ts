import { getDb } from "../../../db";
import { participants, reviews } from "../../../db/schema";
import {
  cleanText,
  ensureReviewSchema,
  fileKeyForReview,
  getReviewFiles,
  hashToken,
  jsonError,
  makeId,
  MAX_FILE_BYTES,
  MAX_NAME_LENGTH,
  MAX_PAGE_COUNT,
  MAX_TITLE_LENGTH,
  nowIso,
} from "../../../lib/review-server";
import { inspectPdfStream, requestFailure } from "../../../lib/request-validation";

function decodeHeader(value: string | null) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/pdf")) {
      return jsonError("Choose a PDF file.", 415);
    }

    const claimedSize = Number(request.headers.get("x-file-size"));
    const contentLength = Number(request.headers.get("content-length"));
    if (
      !Number.isInteger(claimedSize) ||
      claimedSize < 1 ||
      claimedSize > MAX_FILE_BYTES ||
      (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES)
    ) {
      return jsonError("The PDF must be 100 MB or smaller.", 413);
    }
    if (request.headers.has("content-length") && contentLength !== claimedSize) {
      return jsonError("The upload size does not match its declared size.");
    }

    // The browser inspects page count. This bound is not server-side PDF parsing.
    const pageCount = Number(request.headers.get("x-page-count"));
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
      return jsonError("The PDF must contain between 1 and 1,000 pages.");
    }

    const filenameHeader = decodeHeader(request.headers.get("x-file-name"));
    const ownerHeader = decodeHeader(request.headers.get("x-reviewer-name"));
    const titleHeader = decodeHeader(request.headers.get("x-review-title"));
    if (filenameHeader.length > 180 || ownerHeader.length > MAX_NAME_LENGTH || titleHeader.length > MAX_TITLE_LENGTH) {
      return jsonError("The filename, reviewer name, or title is too long.");
    }
    const filename = cleanText(filenameHeader, 180)
      .replace(/[\\/]/g, "-");
    const ownerName = cleanText(
      ownerHeader,
      MAX_NAME_LENGTH,
    );
    const requestedTitle = cleanText(
      titleHeader,
      MAX_TITLE_LENGTH,
    );
    if (!filename.toLowerCase().endsWith(".pdf")) {
      return jsonError("Choose a file whose name ends in .pdf.");
    }
    if (!ownerName) return jsonError("Enter your name.");

    const reviewId = makeId(15);
    const ownerToken = makeId(32);
    const participantToken = makeId(32);
    const participantId = makeId(18);
    const fileKey = fileKeyForReview(reviewId);
    const title = requestedTitle || filename.replace(/\.pdf$/i, "");
    const createdAt = nowIso();
    const body = request.body;
    if (!body) return jsonError("The uploaded PDF was empty.");

    await ensureReviewSchema();
    const bucket = getReviewFiles();
    const inspected = inspectPdfStream(body, claimedSize, MAX_FILE_BYTES);
    try {
      // R2 requires a known-length stream. The inspecting stream independently
      // checks every byte and errors for a false size; no full-file buffering.
      const FixedLength = (globalThis as unknown as {
        FixedLengthStream: new (length: number) => TransformStream<Uint8Array, Uint8Array>;
      }).FixedLengthStream;
      const upload = FixedLength ? inspected.stream.pipeThrough(new FixedLength(claimedSize)) : inspected.stream;
      await bucket.put(fileKey, upload, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { originalName: encodeURIComponent(filename) },
      });
      const db = getDb();
      await db.batch([
        db.insert(reviews).values({
          id: reviewId,
          title,
          filename,
          fileKey,
          fileSize: inspected.size(),
          pageCount,
          ownerName,
          ownerTokenHash: await hashToken(ownerToken),
          createdAt,
          updatedAt: createdAt,
        }),
        db.insert(participants).values({
          id: participantId,
          reviewId,
          displayName: ownerName,
          tokenHash: await hashToken(participantToken),
          createdAt,
          lastSeenAt: createdAt,
        }),
      ]);
    } catch (error) {
      await bucket.delete(fileKey).catch(() => undefined);
      // Storage adapters may wrap stream failures; retain the validation status.
      throw inspected.failure() ?? error;
    }

    return Response.json(
      {
        reviewId,
        ownerToken,
        participantToken,
        sharePath: `/review/${reviewId}`,
        pageCountVerified: false,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return requestFailure(error, "Unable to create the review.");
  }
}
