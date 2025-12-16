import { auth } from "@/lib/auth";
import { ApiError, ErrorCodes, respondWithError } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { StreamingBodyHelper } from "@/utils/streaming-body";

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
    const apiError = handleProxyError(error, req);
    return respondWithError(res, apiError);
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
      const streamingBody = tryCreateStreamingBody(req);
      if (streamingBody) {
        return streamingBody;
      }
      logger.warn(
        "[Auth Proxy] readable stream body could not be wrapped; falling back to no body"
      );
    }
    return undefined;
  }

  if (typeof incoming === "string" || Buffer.isBuffer(incoming)) {
    return typeof incoming === "string"
      ? incoming
      : new Uint8Array(incoming);
  }

  if (StreamingBodyHelper.isReadableStream(incoming)) {
    return incoming;
  }

  if (incoming instanceof Readable) {
    const streamingBody = tryCreateStreamingBody(incoming);
    if (streamingBody) {
      return streamingBody;
    }
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
    try {
      const nodeStream = toNodeReadable(response.body);
      await pipeStreamToResponse(nodeStream, res);
      return;
    } catch (streamError) {
      logger.error("[Auth Proxy] streaming response failed", streamError);
      if (!res.headersSent) {
        res
          .status(502)
          .send("Upstream authentication stream interrupted unexpectedly");
        return;
      }
    }
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

const handleProxyError = (error: unknown, req: NextApiRequest): ApiError => {
  logger.error("[Auth Proxy] request failed", {
    error,
    method: req.method,
    url: req.url,
  });

  if (error instanceof ApiError) {
    return error;
  }

  return new ApiError(
    ErrorCodes.UPSTREAM_ERROR,
    resolveErrorMessage(error),
    resolveErrorStatus(error),
    {
      details: error instanceof Error ? error.message : undefined,
    }
  );
};

const toNodeReadable = (body: ReadableStream<Uint8Array>): Readable => {
  if (
    typeof Readable.fromWeb === "function" &&
    StreamingBodyHelper.isReadableStream(body)
  ) {
    return Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
  }

  const reader = body.getReader();

  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        if (value) {
          this.push(Buffer.from(value));
        } else {
          this.push(Buffer.alloc(0));
        }
      } catch (error) {
        this.destroy(error instanceof Error ? error : undefined);
      }
    },
    destroy(error, callback) {
      reader
        .cancel()
        .then(() => callback(error), (cancelErr) =>
          callback(cancelErr ?? error)
        );
    },
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

const tryCreateStreamingBody = (
  source: Readable | NodeReadableStream<Uint8Array>
): BodyInit | undefined => {
  try {
    return StreamingBodyHelper.createStreamingBody(source);
  } catch (error) {
    logger.warn("[Auth Proxy] streaming body conversion failed", {
      error,
      source: source?.constructor?.name,
    });
    return undefined;
  }
};

const pipeStreamToResponse = (
  nodeStream: Readable,
  res: NextApiResponse
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const handleError = (error: unknown) => {
      nodeStream.off("error", handleError);
      nodeStream.off("end", handleEnd);
      res.off("error", handleError);
      reject(error);
    };

    const handleEnd = () => {
      nodeStream.off("error", handleError);
      nodeStream.off("end", handleEnd);
      res.off("error", handleError);
      resolve();
    };

    nodeStream.on("error", handleError);
    nodeStream.on("end", handleEnd);
    res.on("error", handleError);
    nodeStream.pipe(res);
  });
};

export const config = {
  api: {
    // Disable Next.js body parsing so we can forward the raw stream to auth handler.
    // The raw stream passthrough keeps Better Auth's multi-value headers,
    // chunked bodies, and SIWN flow intact without buffering.
    bodyParser: false,
  },
};
