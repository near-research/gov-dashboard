import "../../vi-compat";
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { render, waitFor, act } = await import("@testing-library/react");

const listAccounts = vi.fn();
const useSessionMock = vi.fn();
const useNearMock = vi.fn();

const loadAuth = async () => {
  process.env.NEXT_PUBLIC_AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost";
  return import("@/components/providers/auth-provider");
};

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    listAccounts: (...args: any[]) => listAccounts(...args),
  },
  useSession: (...args: any[]) => useSessionMock(...args),
}));

vi.mock("@/hooks/useNear", () => ({
  useNear: (...args: any[]) => useNearMock(...args),
}));

describe("AuthProvider", () => {
  beforeEach(() => {
    listAccounts.mockReset();
    useSessionMock.mockReset();
    useNearMock.mockReset();
  });

  const renderWithAuth = () => {
    let captured: any = null;
    let AuthProvider: any;

    const boot = async () => {
      const mod = await loadAuth();
      AuthProvider = mod.AuthProvider;
      const useAuth = mod.useAuth;
      const Capture: React.FC = function CaptureAuthConsumer() {
        const auth = useAuth();
        useEffect(() => {
          captured = auth;
        }, [auth]);
        return null;
      };

      render(
        <AuthProvider>
          <Capture />
        </AuthProvider>
      );
    };

    return { getAuth: () => captured, boot };
  };

  it("prefers linked NEAR account over wallet fallback", async () => {
    useSessionMock.mockReturnValue({
      data: { user: {}, session: {} },
      isPending: false,
      error: null,
    });
    useNearMock.mockReturnValue({
      wallet: null,
      signedAccountId: "wallet.near",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      provider: null,
      viewFunction: vi.fn(),
      callFunction: vi.fn(),
    });
    listAccounts.mockResolvedValue({
      data: [{ providerId: "siwn", accountId: "linked.near:mainnet" }],
    });

    const { getAuth, boot } = renderWithAuth();
    await act(async () => {
      await boot();
    });

    await waitFor(() => {
      const auth = getAuth();
      expect(auth?.nearAccountId).toBe("linked.near");
      expect(auth?.hasNear).toBe(true);
    });
  });

  it("captures account fetch errors", async () => {
    useSessionMock.mockReturnValue({
      data: { user: {}, session: {} },
      isPending: false,
      error: null,
    });
    useNearMock.mockReturnValue({
      wallet: null,
      signedAccountId: null,
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      provider: null,
      viewFunction: vi.fn(),
      callFunction: vi.fn(),
    });
    listAccounts.mockRejectedValue(new Error("boom"));

    const { getAuth, boot } = renderWithAuth();
    await act(async () => {
      await boot();
    });

    await waitFor(() => {
      const auth = getAuth();
      expect(auth?.accountsError?.message).toBe("boom");
    });
  });
});
