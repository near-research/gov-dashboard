import handler from "@/pages/api/auth/[...all]";
import { auth } from "@/lib/auth";
import { NearAITimeoutError } from "@/lib/near-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough, Readable } from "stream";

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
  } as any);

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
    (auth.handler as any).mockRejectedValue(
      new NearAITimeoutError("Request timeout")
    );

    const req = createReq();
    const res = createRes();

    await expect(handler(req, res)).rejects.toBeInstanceOf(NearAITimeoutError);
  });

  it("serializes JSON payloads once and marks duplex", async () => {
    const payload = { callback: "signin" };
    let capturedRequest: (Request & { duplex?: string }) | undefined;

    (auth.handler as any).mockImplementation(async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      });
    });

    const req = createReq();
    req.method = "POST";
    req.headers["content-type"] = "application/json";
    (req as any).body = payload;

    const res = createRes();
    await handler(req, res);

    expect(capturedRequest).toBeDefined();
    expect(await capturedRequest!.text()).toBe(JSON.stringify(payload));
    expect(capturedRequest!.duplex).toBe("half");
  });

  it("converts Buffer bodies to Uint8Array before proxying", async () => {
    const buffer = Buffer.from("secure");
    let capturedRequest: Request | undefined;

    (auth.handler as any).mockImplementation(async (request: Request) => {
      capturedRequest = request;
      return new Response("ok", { status: 200 });
    });

    const req = createReq();
    req.method = "PUT";
    req.headers["content-type"] = "application/octet-stream";
    (req as any).body = buffer;

    const res = createRes();
    await handler(req, res);

    const array = Buffer.from(await capturedRequest!.arrayBuffer());
    expect(array.toString()).toBe(buffer.toString());
  });

  it("maintains URLSearchParams bodies without re-encoding", async () => {
    const params = new URLSearchParams({ redirect: "/callback" });
    let capturedRequest: Request | undefined;

    (auth.handler as any).mockImplementation(async (request: Request) => {
      capturedRequest = request;
      return new Response("ok", { status: 200 });
    });

    const req = createReq();
    req.method = "POST";
    req.headers["content-type"] = "application/x-www-form-urlencoded";
    (req as any).body = params;

    const res = createRes();
    await handler(req, res);

    expect(await capturedRequest!.text()).toBe(params.toString());
  });

  it("passes through FormData bodies as-is", async () => {
    const form = new FormData();
    form.append("token", "abc");
    let capturedRequest: Request | undefined;

    (auth.handler as any).mockImplementation(async (request: Request) => {
      capturedRequest = request;
      return new Response("ok", { status: 200 });
    });

    const req = createReq();
    req.method = "POST";
    (req as any).body = form;

    const res = createRes();
    await handler(req, res);

    const formData = await capturedRequest!.formData();
    expect(formData.get("token")).toBe("abc");
  });

  it("falls back to URLSearchParams for form-encoded object payloads", async () => {
    const payload = { csrf: "x", format: "urlencoded" };
    let capturedRequest: Request | undefined;

    (auth.handler as any).mockImplementation(async (request: Request) => {
      capturedRequest = request;
      return new Response("ok", { status: 200 });
    });

    const req = createReq();
    req.method = "PATCH";
    req.headers["content-type"] = "application/x-www-form-urlencoded";
    (req as any).body = payload;

    const res = createRes();
    await handler(req, res);

    expect(await capturedRequest!.text()).toBe(
      new URLSearchParams(payload as Record<string, string>).toString()
    );
  });

  it("respects getSetCookie when provided by upstream headers", async () => {
    const setCookies = ["first=1; Path=/", "second=2; Path=/"];
    const headers = new Headers();
    (headers as any).getSetCookie = () => setCookies;

    (auth.handler as any).mockResolvedValue({
      status: 201,
      headers,
      body: null,
      text: async () => "",
    });

    const req = createReq();
    req.method = "POST";
    const res = createRes();

    await handler(req, res);

    expect(res.headers["Set-Cookie"]).toEqual(setCookies);
  });

  it("falls back to raw text when JSON parsing fails", async () => {
    const headers = new Headers();
    headers.set("content-type", "application/json; charset=utf-8");

    (auth.handler as any).mockResolvedValue({
      status: 200,
      headers,
      body: null,
      text: async () => "not : json",
    });

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res._jsonBody).toBeUndefined();
    expect(res._sentBody).toBe("not : json");
  });

  it("pipes streaming responses without text parsing", async () => {
    const nodeStream = new Readable({
      read() {
        this.push("chunk-1");
        this.push("chunk-2");
        this.push(null);
      },
    });
    const webStream = Readable.toWeb(
      nodeStream
    ) as unknown as ReadableStream<Uint8Array>;

    (auth.handler as any).mockResolvedValue(
      new Response(webStream, {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
        },
      })
    );

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.getBody()).toBe("chunk-1chunk-2");
  });
});
