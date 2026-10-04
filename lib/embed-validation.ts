import type { EmbedAnnotationRecord, EmbedAnnotationTransfer, JsonValue } from "./embed-annotation-types";

export const MAX_TRANSFER_BYTES = 512 * 1024;
export const MAX_ANNOTATION_ID_LENGTH = 180;
const supportedTypes = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16]);
const flags = new Set(["invisible", "hidden", "print", "noZoom", "noRotate", "noView", "readOnly", "locked", "toggleNoView", "lockedContents"]);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000;
const integer = (value: unknown, min: number, max: number) => number(value) && Number.isInteger(value) && value >= min && value <= max;
const bounded = (value: unknown, min: number, max: number) => number(value) && value >= min && value <= max;
const string = (value: unknown, max = 2000) => typeof value === "string" && value.length <= max;
const point = (value: unknown) => object(value) && number(value.x) && number(value.y);
const rect = (value: unknown) => object(value) && point(value.origin) && object(value.size) && bounded(value.size.width, 0, 10_000_000) && bounded(value.size.height, 0, 10_000_000);
const array = (value: unknown, check: (item: unknown) => boolean, min = 0, max = 20_000) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
const color = (value: unknown) => typeof value === "string" && /^(#[0-9a-f]{3,8}|transparent)$/i.test(value);

export function validAnnotationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ANNOTATION_ID_LENGTH && /^[A-Za-z0-9_.:@+-]+$/.test(value);
}

function safeJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 20) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 20_000 && value.every((item) => safeJson(item, depth + 1));
  if (!object(value)) return false;
  return Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && safeJson(item, depth + 1));
}

function destination(value: unknown, pageCount: number) {
  if (!object(value) || !integer(value.pageIndex, 0, pageCount - 1) || !object(value.zoom) || !integer(value.zoom.mode, 0, 8) || !array(value.view, number, 0, 4)) return false;
  return value.zoom.mode !== 1 || (object(value.zoom.params) && number(value.zoom.params.x) && number(value.zoom.params.y) && bounded(value.zoom.params.zoom, 0, 1000));
}

function link(value: unknown, pageCount: number) {
  if (!object(value)) return false;
  if (value.type === "destination") return destination(value.destination, pageCount);
  if (value.type !== "action" || !object(value.action)) return false;
  if (value.action.type === 1) return destination(value.action.destination, pageCount);
  if (value.action.type !== 3 || !string(value.action.uri, 2048)) return false;
  try {
    const uri = value.action.uri as string;
    if (/[\u0000-\u0020\u007f]/.test(uri)) return false;
    return ["https:", "http:", "mailto:"].includes(new URL(uri).protocol);
  } catch { return false; }
}

/** Portable, plain-data subset consumed by the self-hosted viewer. No HTML, files or executable actions. */
export function validateEmbedTransfer(value: unknown, options: {
  annotationId: string;
  pageCount?: number;
  authorName?: string;
}): EmbedAnnotationTransfer | null {
  if (!object(value) || !safeJson(value) || value.ctx !== undefined || !object(value.annotation)) return null;
  const annotation = value.annotation;
  const pageCount = options.pageCount ?? 1000;
  if (!validAnnotationId(options.annotationId) || annotation.id !== options.annotationId || !integer(annotation.pageIndex, 0, pageCount - 1) || !integer(annotation.type, 1, 16) || !supportedTypes.has(annotation.type as number) || !rect(annotation.rect)) return null;
  const checks: Record<string, (item: unknown) => boolean> = {
    id: validAnnotationId, pageIndex: (v) => integer(v, 0, pageCount - 1), type: (v) => integer(v, 1, 16), rect,
    author: (v) => string(v, 60), contents: (v) => string(v, 20_000), subject: (v) => string(v, 2000), intent: (v) => string(v, 120),
    created: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 35 && Number.isFinite(Date.parse(v)),
    modified: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 35 && Number.isFinite(Date.parse(v)),
    flags: (v) => array(v, (f) => typeof f === "string" && flags.has(f), 0, 10),
    rotation: (v) => bounded(v, -360, 360), unrotatedRect: rect, blendMode: (v) => integer(v, 0, 15),
    appearanceModes: (v) => integer(v, 0, 7),
    inReplyToId: (v) => validAnnotationId(v) && v !== annotation.id,
    replyType: (v) => v === 1,
    color, strokeColor: color, backgroundColor: color, fontColor: color,
    opacity: (v) => bounded(v, 0, 1), strokeWidth: (v) => bounded(v, 0, 1000), strokeStyle: (v) => integer(v, 0, 6),
    strokeDashArray: (v) => array(v, (n) => bounded(n, 0, 1000), 0, 20),
    cloudyBorderIntensity: (v) => bounded(v, 0, 2),
    rectangleDifferences: (v) => object(v) && [v.left, v.top, v.right, v.bottom].every((n) => bounded(n, 0, 10_000_000)),
    state: (v) => typeof v === "string" && ["Marked", "Unmarked", "Accepted", "Rejected", "Completed", "Cancelled", "None"].includes(v),
    stateModel: (v) => v === "Marked" || v === "Review", name: (v) => integer(v, -1, 37), icon: (v) => integer(v, -1, 37),
    target: (v) => link(v, pageCount),
    fontFamily: (v) => integer(v, -1, 13), fontSize: (v) => bounded(v, 0.1, 1000), textAlign: (v) => integer(v, 0, 2), verticalAlign: (v) => integer(v, 0, 2),
    linePoints: (v) => object(v) && point(v.start) && point(v.end),
    lineEndings: (v) => object(v) && integer(v.start, 0, 10) && integer(v.end, 0, 10),
    lineEnding: (v) => integer(v, 0, 10), calloutLine: (v) => array(v, point, 2, 3),
    vertices: (v) => array(v, point, annotation.type === 7 ? 3 : 2),
    segmentRects: (v) => array(v, rect, 1),
    inkList: (v) => array(v, (stroke) => object(stroke) && array(stroke.points, point, 1), 1),
    open: (v) => typeof v === "boolean",
  };
  // Unknown fields (including custom data, rich HTML, and embedded appearance data)
  // are not transferred to the PDF engine. Known fields must have valid shapes.
  const clean: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(annotation)) {
    if (!checks[key]) continue;
    if (!checks[key](item)) return null;
    clean[key] = item as JsonValue;
  }
  if (annotation.inReplyToId !== undefined && annotation.type !== 1) return null;
  if (annotation.replyType !== undefined && annotation.inReplyToId === undefined) return null;
  const required: Record<number, string[]> = {
    1: ["contents"], 2: ["target"], 3: ["contents", "fontFamily", "fontSize", "fontColor", "textAlign", "verticalAlign"],
    4: ["linePoints"], 7: ["vertices"], 8: ["vertices"], 9: ["segmentRects"], 10: ["segmentRects"], 11: ["segmentRects"], 12: ["segmentRects"], 15: ["inkList"], 16: ["contents", "open"],
  };
  if ((required[annotation.type as number] ?? []).some((key) => clean[key] === undefined)) return null;
  if (options.authorName !== undefined) clean.author = options.authorName;
  if (clean.inReplyToId !== undefined) clean.replyType = 1;
  const transfer = { annotation: clean } as unknown as EmbedAnnotationTransfer;
  return new TextEncoder().encode(JSON.stringify(transfer)).byteLength <= MAX_TRANSFER_BYTES ? transfer : null;
}

export function publicAnnotationRecord(row: Omit<EmbedAnnotationRecord, "transfer" | "deleted" | "invalid"> & {
  transferJson: string;
  deleted: number;
}, pageCount: number): EmbedAnnotationRecord {
  const { transferJson, ...identity } = row;
  if (row.deleted === 1) return { ...identity, deleted: true, transfer: null };
  let transfer = null;
  try { transfer = validateEmbedTransfer(JSON.parse(transferJson), { annotationId: row.id, pageCount, authorName: row.authorName }); } catch { /* Keep one corrupt historical row from breaking the room. */ }
  return { ...identity, deleted: false, transfer, ...(transfer ? {} : { invalid: true }) };
}
