import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";

type AuthProxyRequestInit = RequestInit & {
  duplex?: "half";
};

type HeadersWithGetSetCookie = Headers & {
  getSetCookie?: () => string[];
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const url = new URL(req.url || "", `${protocol}://${host}`);

    const body = normalizeRequestBody(req);

    const requestInit: AuthProxyRequestInit = {
      method: req.method,
      headers: new Headers(req.headers as Record<string, string>),
      body,
    };

    if (body && typeof requestInit.duplex === "undefined") {
      requestInit.duplex = "half";
    }

    const webRequest = new Request(url, requestInit);
    const response = await auth.handler(webRequest);

    await forwardAuthResponse(response, res);
  } catch (error) {
    handleProxyError(error, req, res);
  }
}

const normalizeRequestBody = (req: NextApiRequest): BodyInit | undefined => {
  const methodAllowsBody =
    req.method && req.method !== "GET" && req.method !== "HEAD";
  if (!methodAllowsBody) {
    return undefined;
  }

  const incoming: unknown = req.body;
  const contentType =
    (req.headers["content-type"] as string | undefined) || "";
  const hasReadableBody =
    !!req.readable &&
    (!!req.headers["content-length"] || !!req.headers["transfer-encoding"]);

  if (incoming === null || typeof incoming === "undefined") {
    if (hasReadableBody) {
      return typeof Readable.toWeb === "function"
        ? (Readable.toWeb(req) as BodyInit)
        : ((req as unknown as BodyInit) ?? undefined);
    }
    return undefined;
  }

  if (typeof incoming === "string" || Buffer.isBuffer(incoming)) {
    return typeof incoming === "string"
      ? incoming
      : new Uint8Array(incoming);
  }

  if (
    typeof ReadableStream !== "undefined" &&
    incoming instanceof ReadableStream
  ) {
    return incoming;
  }

  if (incoming instanceof Readable) {
    return typeof Readable.toWeb === "function"
      ? (Readable.toWeb(incoming) as BodyInit)
      : (incoming as unknown as BodyInit);
  }

  if (
    typeof URLSearchParams !== "undefined" &&
    incoming instanceof URLSearchParams
  ) {
    return incoming;
  }

  if (typeof FormData !== "undefined" && incoming instanceof FormData) {
    return incoming as BodyInit;
  }

  if (typeof incoming === "object") {
    if (contentType.includes("application/json")) {
      return JSON.stringify(incoming);
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return new URLSearchParams(incoming as Record<string, string>);
    }
  }

  return undefined;
};

const forwardAuthResponse = async (
  response: Response,
  res: NextApiResponse
) => {
  const responseHeaders = response.headers as HeadersWithGetSetCookie;
  const getSetCookie = responseHeaders.getSetCookie;
  let setCookieHeaders =
    typeof getSetCookie === "function"
      ? getSetCookie.call(responseHeaders)
      : undefined;

  responseHeaders.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      if (setCookieHeaders) return;
      setCookieHeaders = [];
      setCookieHeaders.push(value);
      return;
    }
    res.setHeader(key, value);
  });

  if (!setCookieHeaders) {
    const single = responseHeaders.get("set-cookie");
    setCookieHeaders = single ? [single] : undefined;
  }

  if (setCookieHeaders?.length) {
    res.setHeader("Set-Cookie", setCookieHeaders);
  }

  res.status(response.status);

  if (response.body) {
    const responseBody = response.body;
    const nodeStream =
      typeof Readable.fromWeb === "function"
        ? Readable.fromWeb(responseBody as any)
        : (responseBody as unknown as Readable);

    await new Promise<void>((resolve, reject) => {
      nodeStream.on("error", reject);
      nodeStream.on("end", resolve);
      nodeStream.pipe(res);
    });
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      res.json(JSON.parse(text));
      return;
    } catch {
      // fall through to send raw text
    }
  }

  res.send(text);
};

const handleProxyError = (
  error: unknown,
  req: NextApiRequest,
  res: NextApiResponse
) => {
  logger.error("[Auth Proxy] request failed", {
    error,
    method: req.method,
    url: req.url,
  });

  if (res.headersSent) {
    return;
  }

  res
    .status(resolveErrorStatus(error))
    .json({
      error: "Authentication proxy error",
      message: resolveErrorMessage(error),
    });
};

const resolveErrorStatus = (error: unknown): number => {
  if (typeof error === "object" && error !== null) {
    const typed = error as { status?: unknown; statusCode?: unknown };
    if (typeof typed.status === "number") {
      return typed.status;
    }
    if (typeof typed.statusCode === "number") {
      return typed.statusCode;
    }
  }
  return 502;
};

const resolveErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
};

export const config = {
  api: {
    // Disable Next.js body parsing so we can forward the raw stream to auth handler.
    bodyParser: false,
  },
};
