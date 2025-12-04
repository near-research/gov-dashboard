import { auth } from "@/lib/auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = new URL(req.url || "", `${protocol}://${host}`);

  // Preserve incoming body without double-encoding JSON/Buffer payloads.
  let body: BodyInit | undefined;
  const methodAllowsBody =
    req.method && req.method !== "GET" && req.method !== "HEAD";

  if (methodAllowsBody) {
    const incoming = (req as any).body;
    const contentType =
      (req.headers["content-type"] as string | undefined) || "";
    const hasReadableBody =
      !!req.readable &&
      (!!req.headers["content-length"] || !!req.headers["transfer-encoding"]);

    if (incoming === null || typeof incoming === "undefined") {
      if (hasReadableBody) {
        body =
          typeof Readable.toWeb === "function"
            ? (Readable.toWeb(req) as BodyInit)
            : ((req as unknown as BodyInit) ?? undefined);
      }
    } else if (typeof incoming === "string" || Buffer.isBuffer(incoming)) {
      body =
        typeof incoming === "string"
          ? incoming
          : new Uint8Array(incoming); // convert Buffer to a typed array accepted by BodyInit
    } else if (
      typeof ReadableStream !== "undefined" &&
      incoming instanceof ReadableStream
    ) {
      body = incoming;
    } else if (incoming instanceof Readable) {
      body =
        typeof Readable.toWeb === "function"
          ? (Readable.toWeb(incoming) as BodyInit)
          : (incoming as unknown as BodyInit);
    } else if (
      typeof URLSearchParams !== "undefined" &&
      incoming instanceof URLSearchParams
    ) {
      body = incoming;
    } else if (typeof FormData !== "undefined" && incoming instanceof FormData) {
      body = incoming as BodyInit;
    } else if (typeof incoming === "object") {
      if (contentType.includes("application/json")) {
        body = JSON.stringify(incoming);
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        body = new URLSearchParams(incoming as Record<string, string>);
      }
    }
  }

  const webRequest = new Request(url, {
    method: req.method,
    headers: new Headers(req.headers as Record<string, string>),
    body,
  });

  const response = await auth.handler(webRequest);

  // Preserve multi-value headers like Set-Cookie.
  const getSetCookie = (response.headers as any).getSetCookie;
  let setCookieHeaders =
    typeof getSetCookie === "function"
      ? (getSetCookie.call(response.headers) as string[])
      : undefined;

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      if (setCookieHeaders) return;
      setCookieHeaders = [];
      setCookieHeaders.push(value);
      return;
    }
    res.setHeader(key, value);
  });

  if (!setCookieHeaders) {
    const single = response.headers.get("set-cookie");
    setCookieHeaders = single ? [single] : undefined;
  }

  if (setCookieHeaders?.length) {
    res.setHeader("Set-Cookie", setCookieHeaders);
  }

  res.status(response.status);

  // Stream the response when possible to keep binary bodies intact.
  if (response.body) {
    const nodeStream =
      typeof Readable.fromWeb === "function"
        ? Readable.fromWeb(response.body as any)
        : (response.body as any);

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
}

export const config = {
  api: {
    // Disable Next.js body parsing so we can forward the raw stream to auth handler.
    bodyParser: false,
  },
};
