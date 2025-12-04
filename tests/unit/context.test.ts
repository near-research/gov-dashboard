import type { GetServerSidePropsContext, NextApiRequest } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, getSessionFromContext, getSessionFromReq } from "@/lib/context";
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
});
