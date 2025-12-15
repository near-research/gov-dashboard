import "../../vi-compat";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Near } from "near-kit";
import {
  NearError,
  NetworkError,
} from "near-kit";
import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

import { classifyNearError, useNear } from "@/hooks/useNear";

const {
  signMessageMock,
  viewMock,
  callMock,
  getBalanceMock,
  mockNearClient,
  authClientMock,
  safeSignOutMock,
  useSessionMock,
  refetchSessionMock,
  setSessionState,
} = vi.hoisted(() => {
  const signMessageMock = vi.fn();
  const viewMock = vi.fn();
  const callMock = vi.fn();
  const getBalanceMock = vi.fn(async () => ({}));

  const mockNearClient = {
    signMessage: signMessageMock,
    view: viewMock,
    call: callMock,
    getBalance: getBalanceMock,
  } as unknown as Near;

  const authClientMock = {
    near: {
      getNearClient: vi.fn(() => mockNearClient),
      getAccountId: vi.fn(() => ""),
    },
    requestSignIn: {
      near: vi.fn(),
    },
    signIn: {
      near: vi.fn(),
    },
    signOut: vi.fn(),
  };

  const safeSignOutMock = vi.fn();
  const refetchSessionMock = vi.fn();
  let sessionState: {
    data: unknown;
    isPending: boolean;
    refetch: typeof refetchSessionMock;
  } = {
    data: null,
    isPending: false,
    refetch: refetchSessionMock,
  };
  const setSessionState = (data: unknown, isPending = false) => {
    sessionState = {
      data,
      isPending,
      refetch: refetchSessionMock,
    };
  };

  const useSessionMock = vi.fn(() => sessionState);

  return {
    signMessageMock,
    viewMock,
    callMock,
    getBalanceMock,
    mockNearClient,
    authClientMock,
    safeSignOutMock,
    useSessionMock,
    refetchSessionMock,
    setSessionState,
  };
});

const handleUnhandledRejection = (error: unknown) => {
  if (
    error instanceof Error &&
    /(User rejected authorization|Network failure)/.test(error.message)
  ) {
    return;
  }
  throw error;
};

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: authClientMock,
  safeSignOut: safeSignOutMock,
  useSession: useSessionMock,
}));

const setSession = (data: unknown, isPending = false) => {
  setSessionState(data, isPending);
};

const resetMocks = () => {
  vi.resetAllMocks();
  setSession(null, true);
  authClientMock.near.getNearClient.mockReturnValue(mockNearClient);
  authClientMock.near.getAccountId.mockReturnValue("");
  authClientMock.requestSignIn.near.mockResolvedValue(undefined);
  authClientMock.signIn.near.mockResolvedValue(undefined);
  authClientMock.signOut.mockResolvedValue(undefined);
  safeSignOutMock.mockResolvedValue(undefined);
  signMessageMock.mockResolvedValue({
    signature: "sig",
    publicKey: "public",
    accountId: "",
  });
  viewMock.mockResolvedValue({});
  callMock.mockResolvedValue({});
};

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useNear", () => {
  beforeAll(() => {
    process.on("unhandledRejection", handleUnhandledRejection);
  });

  afterAll(() => {
    process.off("unhandledRejection", handleUnhandledRejection);
  });
  describe("initial state", () => {
    it("returns empty signedAccountId when not authenticated", async () => {
      const { result } = renderHook(() => useNear());
      await waitFor(() => expect(result.current.loading).toBe(true));
      expect(result.current.signedAccountId).toBe("");
    });

    it("returns null walletSigner when not authenticated", async () => {
      setSession(null, false);
      const { result } = renderHook(() => useNear());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.walletSigner).toBeNull();
    });

    it("returns isLoading true during session check", () => {
      setSession(null, true);
      const { result } = renderHook(() => useNear());
      expect(result.current.loading).toBe(true);
    });
  });

  describe("authenticated state", () => {
    const signedAccount = "alice.testnet";

    beforeEach(() => {
      setSession(
        {
          user: {
            accounts: [
              { providerId: "siwn", accountId: `${signedAccount}:0` },
            ],
          },
        },
        false
      );
      authClientMock.near.getAccountId.mockReturnValue(signedAccount);
    });

    it("returns signedAccountId from session", async () => {
      const { result } = renderHook(() => useNear());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.signedAccountId).toBe(signedAccount);
    });

    it("returns valid walletSigner that wraps auth client", async () => {
      const { result } = renderHook(() => useNear());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.walletSigner).not.toBeNull();
      await act(async () => {
        await result.current.walletSigner!.signMessage({
          message: "hi",
          recipient: "social.near",
          nonce: new TextEncoder().encode("nonce"),
        });
      });
      expect(mockNearClient.signMessage).toHaveBeenCalledWith(
        { message: "hi" },
        { signerId: signedAccount }
      );
    });
  });

  describe("signIn", () => {
    it("triggers authClient sign-in flow", async () => {
      authClientMock.near.getAccountId.mockReturnValue("bob.testnet");
      setSession(null, false);

      const { result } = renderHook(() => useNear());
      await act(async () => {
        await result.current.signIn();
      });

      expect(authClientMock.requestSignIn.near).toHaveBeenCalled();
      expect(authClientMock.signIn.near).toHaveBeenCalled();
      expect(refetchSessionMock).toHaveBeenCalled();
      await waitFor(() =>
        expect(result.current.walletAccountId).toBe("bob.testnet")
      );
      expect(result.current.signedAccountId).toBe("bob.testnet");
    });

    it("handles sign in cancellation", async () => {
      authClientMock.signIn.near.mockRejectedValue(
        new Error("User rejected authorization")
      );
      setSession(null, false);
      const { result } = renderHook(() => useNear());

      await act(async () => {
        const promise = result.current.signIn();
        await expect(promise).rejects.toThrow(/User rejected/);
      });

      await waitFor(() =>
        expect(result.current.walletAccountId).toBe("")
      );
    });

    it("handles sign in errors", async () => {
      authClientMock.requestSignIn.near.mockRejectedValue(
        new Error("Network failure")
      );
      setSession(null, false);
      const { result } = renderHook(() => useNear());

      await act(async () => {
        const promise = result.current.signIn();
        await expect(promise).rejects.toThrow(/Network failure/);
      });

      await waitFor(() =>
        expect(result.current.walletAccountId).toBe("")
      );
    });
  });

  describe("signOut", () => {
    it("triggers safeSignOut and clears state", async () => {
      setSession(
        {
          user: {
            accounts: [{ providerId: "siwn", accountId: "carol.testnet:0" }],
          },
        },
        false
      );
      const { result } = renderHook(() => useNear());
      await waitFor(() => expect(result.current.signedAccountId).toBe("carol.testnet"));

      await act(async () => {
        await result.current.signOut();
      });

      expect(safeSignOutMock).toHaveBeenCalled();
      expect(refetchSessionMock).toHaveBeenCalled();
      await waitFor(() => expect(result.current.signedAccountId).toBe(""));
      expect(result.current.walletSigner).toBeNull();
    });
  });
});

describe("classifyNearError", () => {
  it("classifies user rejection errors", () => {
    const error = new NearError("User rejected", "ACTION_REJECTED") as NearError &
      { retryable?: boolean };
    error.retryable = false;
    const classification = classifyNearError(error);
    expect(classification).toMatchObject({
      message: "User rejected",
      retryable: false,
      code: "ACTION_REJECTED",
    });
  });

  it("classifies network errors", () => {
    const error = new NetworkError("Network down", 502, true);
    const classification = classifyNearError(error);
    expect(classification).toMatchObject({
      message: "Network down",
      retryable: true,
      code: "NETWORK_ERROR",
    });
  });

  it("classifies timeout errors", () => {
    const error = new NearError("Request timed out", "TIMEOUT") as NearError &
      { retryable?: boolean };
    error.retryable = true;
    const classification = classifyNearError(error);
    expect(classification).toMatchObject({
      message: "Request timed out",
      retryable: true,
      code: "TIMEOUT",
    });
  });

  it("returns generic classification for unknown errors", () => {
    const classification = classifyNearError(new Error("Unknown failure"));
    expect(classification).toMatchObject({
      message: "Unknown failure",
      retryable: false,
    });
    expect(classification.code).toBeUndefined();
  });
});
