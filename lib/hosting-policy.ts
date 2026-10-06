// Pure policy and SQL shared by the Worker and local regression tests.
export const DEFAULT_MAX_ROOMS = 20;
export const DEFAULT_MAX_STORED_BYTES = 512 * 1024 * 1024;

export function positiveLimit(value: unknown, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Invalid hosting limit configuration.");
  return parsed;
}

export function secretConfigured(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 256;
}

export async function matchesSecret(candidate: string, configured: unknown): Promise<boolean> {
  if (!secretConfigured(configured) || candidate.length > 256) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(candidate), digest(configured)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export const RESERVE_UPLOAD_SQL = `
INSERT INTO upload_reservations (review_id, file_key, file_size, created_at)
SELECT ?1, ?2, ?3, ?4
WHERE (SELECT COUNT(*) FROM reviews) + (SELECT COUNT(*) FROM upload_reservations) < ?5
AND (SELECT COALESCE(SUM(file_size), 0) FROM reviews)
  + (SELECT COALESCE(SUM(file_size), 0) FROM upload_reservations) + ?3 <= ?6`;

export const RATE_LIMIT_SQL = `
INSERT INTO rate_limits (key, window_start, hits) VALUES (?1, ?2, 1)
ON CONFLICT(key) DO UPDATE SET
  window_start = CASE WHEN rate_limits.window_start <= ?2 - ?4 THEN ?2 ELSE rate_limits.window_start END,
  hits = CASE WHEN rate_limits.window_start <= ?2 - ?4 THEN 1 ELSE rate_limits.hits + 1 END
WHERE rate_limits.window_start <= ?2 - ?4 OR rate_limits.hits < ?3`;
