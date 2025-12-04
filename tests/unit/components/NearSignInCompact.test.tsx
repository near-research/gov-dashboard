import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { render, screen, fireEvent, act } = await import("@testing-library/react");
let toast: any;

const walletSignIn = vi.fn();
const walletSignOut = vi.fn();
const requestSignIn = vi.fn();
const signIn = vi.fn();
var authClientMock: any;

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: null,
    isPending: false,
    nearAccountId: null,
    walletAccountId: currentAuthState.walletAccountId,
    walletSignIn,
    walletSignOut,
    wallet: {},
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: (authClientMock =
    authClientMock ||
    {
      requestSignIn: { near: (...args: any[]) => requestSignIn(...args) },
      signIn: { near: (...args: any[]) => signIn(...args) },
      signOut: vi.fn(),
      near: { disconnect: vi.fn() },
    }),
}));

const loadComponent = async () => {
  process.env.NEXT_PUBLIC_AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost";
  const mod = await import("@/components/auth/near-sign-in-compact");
  return mod.NearSignInCompact;
};

const currentAuthState = {
  walletAccountId: null as string | null,
};

describe("NearSignInCompact", () => {
  beforeEach(async () => {
    toast = (await import("sonner")).toast as any;
    currentAuthState.walletAccountId = null;
    walletSignIn.mockReset();
    walletSignOut.mockReset();
    requestSignIn.mockReset();
    signIn.mockReset();
    authClientMock?.near.disconnect.mockReset();
    vi.clearAllMocks();
  });

  it("connects wallet then signs in", async () => {
    const NearSignInCompact = await loadComponent();
    walletSignIn.mockResolvedValue(undefined);
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => handlers.onSuccess());

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(walletSignIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("retries nonce once then succeeds", async () => {
    const NearSignInCompact = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    let attempt = 0;
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => {
      attempt += 1;
      if (attempt === 1) {
        handlers.onError?.({ code: "NONCE_NOT_FOUND" });
      } else {
        handlers.onSuccess();
      }
    });

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("disconnects wallet on fatal auth error", async () => {
    const NearSignInCompact = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => {
      handlers.onError?.(new Error("boom"));
    });

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(authClientMock.near.disconnect).toHaveBeenCalled();
    expect(walletSignOut).toHaveBeenCalled();
  });

  it("surfaces network mismatch without disconnecting", async () => {
    const NearSignInCompact = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) =>
      handlers.onError?.({ code: "NETWORK_MISMATCH" })
    );

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(toast.error).toHaveBeenCalledWith(
      "Connected wallet is on a different network."
    );
    expect(authClientMock.near.disconnect).not.toHaveBeenCalled();
    expect(walletSignOut).not.toHaveBeenCalled();
  });

  it("does not disconnect on user-rejected wallet connection", async () => {
    const NearSignInCompact = await loadComponent();
    walletSignIn.mockRejectedValue(new Error("User rejected"));

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(authClientMock.near.disconnect).not.toHaveBeenCalled();
    expect(walletSignOut).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Wallet connection cancelled");
  });

  it("does not disconnect on user-rejected sign-in", async () => {
    const NearSignInCompact = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => {
      handlers.onError?.(new Error("User rejected"));
    });

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(authClientMock.near.disconnect).not.toHaveBeenCalled();
    expect(walletSignOut).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Wallet connection cancelled");
  });

  it("disconnects after repeated nonce failures and surfaces error message", async () => {
    const NearSignInCompact = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => handlers.onError?.({ code: "NONCE_NOT_FOUND" }));

    render(<NearSignInCompact />);
    await act(async () => fireEvent.click(screen.getByRole("button")));

    expect(signIn).toHaveBeenCalledTimes(2); // initial + retry
    expect(authClientMock.near.disconnect).toHaveBeenCalled();
    expect(walletSignOut).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Authentication failed");
  });
});
