import type { EmbedAnnotationRecord } from "./embed-annotation-types";

/** The viewer cascades local deletion before emitting committed events. Protect
 * the whole thread, including children emitted before their parent. */
export function protectedThreadIds(
  parentId: string,
  rows: Iterable<EmbedAnnotationRecord>,
  pendingDeletes: Iterable<{ id: string; inReplyToId?: unknown }>,
): string[] {
  const children = new Set<string>();
  for (const row of rows) {
    if (!row.deleted && row.transfer?.annotation.inReplyToId === parentId) children.add(row.id);
  }
  for (const annotation of pendingDeletes) {
    if (annotation.inReplyToId === parentId) children.add(annotation.id);
  }
  return children.size ? [parentId, ...children] : [];
}
