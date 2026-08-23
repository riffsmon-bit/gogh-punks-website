import { ConfigurationError, getSiteUrl } from "./config.mjs";

export class PublicError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PublicError";
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export async function readJson(request, maximumBytes = 16_384) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes) {
    throw new PublicError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new PublicError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new PublicError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  const configuredOrigin = getSiteUrl();
  const allowedOrigins = new Set([configuredOrigin]);
  if (configuredOrigin === "https://goghpunks.xyz") {
    allowedOrigins.add("https://app.goghpunks.xyz");
  }
  if (!origin || !allowedOrigins.has(origin)) {
    throw new PublicError(403, "ORIGIN_REJECTED", "The request origin was rejected.");
  }
}

export function publicFailure(error) {
  if (error instanceof PublicError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  if (error instanceof ConfigurationError) {
    console.error(JSON.stringify({ event: "GTD_CONFIGURATION_ERROR", code: error.code }));
    return json(
      {
        ok: false,
        code: error.code,
        message: "GTD capture is not configured yet. Please try again later.",
      },
      503,
    );
  }
  console.error(
    JSON.stringify({
      event: "GTD_UNEXPECTED_ERROR",
      type: error?.name ?? "Error",
    }),
  );
  return json(
    {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GTD capture is temporarily unavailable. No role or wallet record was changed.",
    },
    503,
  );
}
