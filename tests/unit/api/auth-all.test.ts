import handler from "@/pages/api/auth/[...all]";
import { auth } from "@/lib/auth";
import { NearAITimeoutError } from "@/lib/near-ai/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "stream";

vi.mock("@/lib/auth", () => ({
  auth: {
    handler: vi.fn(),
  },
}));

const createReq = () =>
  ({
    method: "GET",
    headers: {
      host: "example.org",
    },
    url: "/api/auth",
  }) as any;

const createRes = () => {
  const headers: Record<string, any> = {};
  const stream = new PassThrough();
  const bodyChunks: Array<Buffer> = [];

  stream.on("data", (chunk) => {
    bodyChunks.push(Buffer.from(chunk));
  });

  const res: any = stream;
  res.headers = headers;
  res.statusCode = 200;
  res.setHeader = (key: string, value: any) => {
    headers[key] = value;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value: any) => {
    res._jsonBody = value;
    return res;
  };
  res.send = (value: any) => {
    res._sentBody = value;
    return res;
  };
  res.getBody = () => {
    if (res._jsonBody !== undefined) return res._jsonBody;
    if (res._sentBody !== undefined) return res._sentBody;
    return Buffer.concat(bodyChunks).toString();
  };

  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth proxy", () => {
  it("forwards multi-value Set-Cookie headers intact", async () => {
    const setCookies = ["a=1; Path=/; HttpOnly", "b=2; Path=/; Secure"];
    const mockedResponse = new Response(null, {
      status: 204,
      headers: new Headers([
        ["set-cookie", setCookies[0]],
        ["set-cookie", setCookies[1]],
        ["x-test", "yes"],
      ]),
    });

    (auth.handler as any).mockResolvedValue(mockedResponse);

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.headers["Set-Cookie"]).toEqual(setCookies);
    expect(res.headers["x-test"]).toBe("yes");
    expect(res.getBody()).toBe("");
  });

  it("passes through 200 JSON responses with headers and body intact", async () => {
    const payload = { ok: true };
    const mockedResponse = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-proxy": "auth",
      },
    });

    (auth.handler as any).mockResolvedValue(mockedResponse);

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["x-proxy"]).toBe("auth");
    expect(res.getBody()).toBe(JSON.stringify(payload));
  });

  it("forwards redirects with Location header", async () => {
    const mockedResponse = new Response(null, {
      status: 302,
      headers: {
        Location: "https://accounts.example.com/login",
      },
    });

    (auth.handler as any).mockResolvedValue(mockedResponse);

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(302);
    expect(res.headers["location"]).toBe("https://accounts.example.com/login");
  });

  it("propagates upstream 5xx bodies and status codes", async () => {
    const mockedResponse = new Response("boom", {
      status: 503,
      headers: {
        "content-type": "text/plain",
      },
    });

    (auth.handler as any).mockResolvedValue(mockedResponse);

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.getBody()).toBe("boom");
  });

  it("rejects when auth handler throws configuration errors", async () => {
    (auth.handler as any).mockRejectedValue(new Error("Missing env"));

    const req = createReq();
    const res = createRes();

    await expect(handler(req, res)).rejects.toThrow("Missing env");
  });

  it("propagates NearAI timeout errors for observability", async () => {
    (auth.handler as any).mockRejectedValue(new NearAITimeoutError("Request timeout"));

    const req = createReq();
    const res = createRes();

    await expect(handler(req, res)).rejects.toBeInstanceOf(NearAITimeoutError);
  });
});
