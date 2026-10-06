import { env } from "cloudflare:workers";
import { RequestError } from "./request-validation";
import { ensureReviewSchema, getReviewD1, hashToken } from "./review-server";
import { DEFAULT_MAX_ROOMS, DEFAULT_MAX_STORED_BYTES, matchesSecret, positiveLimit, RATE_LIMIT_SQL, RESERVE_UPLOAD_SQL, secretConfigured } from "./hosting-policy";

export function creationEnabled() { return secretConfigured(env.MARKROOM_CREATION_KEY); }

export async function requireCreator(request: Request) {
  if (!creationEnabled()) throw new RequestError("Room creation is disabled. Ask the operator for access.", 503);
  if (!await matchesSecret(request.headers.get("x-markroom-creation-key") ?? "", env.MARKROOM_CREATION_KEY)) {
    throw new RequestError("Enter a valid creation key from the operator.", 403);
  }
}

export async function requireOperator(request: Request) {
  const bearer = request.headers.get("authorization") ?? "";
  if (!bearer.startsWith("Bearer ") || !await matchesSecret(bearer.slice(7), env.MARKROOM_OPERATOR_KEY)) {
    throw new RequestError("Operator authorization required.", 403);
  }
}

export async function enforceRateLimit(request: Request, scope: string, limit: number, seconds: number) {
  await ensureReviewSchema();
  const db = getReviewD1();
  const now = Math.floor(Date.now() / 1000);
  // Cloudflare supplies this header. Direct local previews share one bucket.
  // Keyed hashing avoids storing raw addresses or unsalted address hashes.
  const address = request.headers.get("cf-connecting-ip") ?? "local";
  const salt = env.MARKROOM_RATE_SALT || env.MARKROOM_CREATION_KEY || env.MARKROOM_OPERATOR_KEY;
  if (!secretConfigured(salt)) throw new RequestError("Hosting controls need a configured rate-limit secret.", 503);
  const key = await hashToken(`${salt}:${scope}:${address}`);
  // Every window is at most one hour. Expired rows cannot accumulate indefinitely.
  await db.prepare("DELETE FROM rate_limits WHERE window_start <= ?1").bind(now - 3600).run();
  // Bound the number of buckets too, including distributed attempts.
  const result = await db.prepare(RATE_LIMIT_SQL.replace("VALUES (?1, ?2, 1)",
    "SELECT ?1, ?2, 1 WHERE (SELECT COUNT(*) FROM rate_limits) < 10000 OR EXISTS (SELECT 1 FROM rate_limits WHERE key = ?1)")).bind(key, now, limit, seconds).run();
  if (result.meta.changes !== 1) throw new RequestError("Too many requests. Try again later.", 429);
}

export async function reserveUpload(reviewId: string, fileKey: string, bytes: number) {
  const limit = positiveLimit(env.MARKROOM_MAX_ROOMS, DEFAULT_MAX_ROOMS);
  const storage = positiveLimit(env.MARKROOM_MAX_STORED_BYTES, DEFAULT_MAX_STORED_BYTES);
  const result = await getReviewD1().prepare(RESERVE_UPLOAD_SQL)
    .bind(reviewId, fileKey, bytes, Math.floor(Date.now() / 1000), limit, storage).run();
  if (result.meta.changes !== 1) throw new RequestError("This installation has reached its room or storage budget. Contact the operator.", 507);
}
