export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function readJsonObject(request: Request, maxBytes = 600 * 1024): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new RequestError("Send a JSON request.", 415);
  if (!request.body) throw new RequestError("The request body is missing.");
  const claimed = request.headers.get("content-length");
  if (claimed !== null && Number(claimed) > maxBytes) throw new RequestError("The request is too large.", 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RequestError("The request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new RequestError("Send a valid JSON object."); }
}

/** Counts bytes while streaming; keeps only the 8-byte signature, not the PDF. */
export function inspectPdfStream(body: ReadableStream<Uint8Array>, expectedBytes: number, maxBytes: number) {
  let size = 0;
  let prefix = new Uint8Array(0);
  let signatureChecked = false;
  let failure: RequestError | null = null;
  function fail(message: string, status: number): never {
    failure = new RequestError(message, status);
    throw failure;
  }
  const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > maxBytes || size > expectedBytes) fail("The uploaded PDF exceeds its declared size or the upload limit.", 413);
      if (!signatureChecked) {
        const next = new Uint8Array(Math.min(8, prefix.length + chunk.length));
        next.set(prefix);
        next.set(chunk.subarray(0, next.length - prefix.length), prefix.length);
        prefix = next;
        if (prefix.length === 8) {
          if (!/^%PDF-(1\.[0-7]|2\.0)$/.test(new TextDecoder().decode(prefix))) fail("The file does not begin with a supported PDF signature.", 415);
          signatureChecked = true;
        }
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (!signatureChecked) fail("The uploaded PDF is empty or incomplete.", 415);
      if (size !== expectedBytes) fail("The uploaded PDF size does not match its declared size.", 400);
    },
  }));
  return { stream, size: () => size, failure: () => failure };
}

export function requestFailure(error: unknown, fallback: string) {
  return Response.json({ error: error instanceof RequestError ? error.message : fallback }, { status: error instanceof RequestError ? error.status : 500 });
}
