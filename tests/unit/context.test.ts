import type { GetServerSidePropsContext, NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContext,
  getSessionFromContext,
  getSessionFromReq,
  formatApiResponse,
  requireAuth,
  UnauthorizedError,
} from "@/lib/context";
import { createMockHeaders, mockSession } from "../fixtures/context";

const getSessionMock = vi.fn();

vi.mock("@/lib/auth", () => {
  return {
    auth: {
      api: {
        getSession: (...args: any[]) => getSessionMock(...args),
      },
    },
  };
});

describe("context helpers", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue(mockSession);
  });

  it("builds context with verification metadata preserved from API requests", async () => {
    const req = { headers: createMockHeaders() } as unknown as NextApiRequest;

    const context = await createContext(req);

    expect(context.session).toEqual(mockSession);
    expect(context.verification).toEqual({
      verificationId: "ver-123",
      verificationNonce: "nonce-abc",
    });

    const headers = getSessionMock.mock.calls[0][0].headers as Headers;
    expect(headers.get("x-verification-id")).toBe("ver-123");
    expect(headers.get("x-nonce")).toBe("nonce-abc");
    expect(headers.get("set-cookie")).toContain("sid=one");
    expect(headers.get("set-cookie")).toContain("sid=two");
  });

  it("supports getSessionFromContext without hitting real auth", async () => {
    const ctx = {
      req: { headers: { ...createMockHeaders(), "x-nonce": "nonce-override" } },
    } as unknown as GetServerSidePropsContext;

    const session = await getSessionFromContext(ctx);

    expect(session).toEqual(mockSession);
    const headers = getSessionMock.mock.calls[0][0].headers as Headers;
    expect(headers.get("x-verification-id")).toBe("ver-123");
    expect(headers.get("x-nonce")).toBe("nonce-override");
  });

  it("returns undefined verification when headers are absent", async () => {
    const req = { headers: { cookie: "session=abc" } } as unknown as NextApiRequest;

    const context = await createContext(req);

    expect(context.verification).toBeUndefined();
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("throws UnauthorizedError when requireAuth cannot find a user", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const req = { headers: {} } as unknown as NextApiRequest;

    await expect(requireAuth(req)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("formats API responses by applying status before JSON", () => {
    const body = { ok: true };
    const statusMock = vi.fn();
    const jsonMock = vi.fn();
    const res = {
      status: statusMock,
      json: jsonMock,
    } as unknown as NextApiResponse<typeof body>;
    statusMock.mockReturnValue(res);

    formatApiResponse(res, 201, body);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith(body);
  });

  it("prefers the first string when headers supply arrays", async () => {
    const req = {
      headers: {
        "x-verification-id": ["first", "second"],
        "x-nonce": ["nonce-value"],
      },
    } as unknown as NextApiRequest;

    const context = await createContext(req);

    expect(context.verification).toEqual({
      verificationId: "first",
      verificationNonce: "nonce-value",
    });
  });
});
