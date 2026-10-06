export function securityHeaders(headers: Headers, nonce: string) {
  headers.set("content-security-policy", [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "));
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

export function secureResponse(response: Response): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  const headers = new Headers(response.headers);
  securityHeaders(headers, nonce);
  let result = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (headers.get("content-type")?.includes("text/html")) {
    // Nonces belong to this response only. Never cache generated HTML with one.
    headers.set("cache-control", "no-store");
    headers.delete("content-length");
    headers.delete("etag");
    result = new Response(result.body, { status: result.status, statusText: result.statusText, headers });
    result = new HTMLRewriter().on("script", {
      element(element) { element.setAttribute("nonce", nonce); },
    }).transform(result);
  }
  return result;
}
