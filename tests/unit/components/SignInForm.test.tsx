import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { render, fireEvent, screen, act } = await import("@testing-library/react");
let toast: any;

const routerPush = vi.fn();
const walletSignIn = vi.fn();
const walletSignOut = vi.fn();
const requestSignIn = vi.fn();
const signIn = vi.fn();
const mockSignOut = vi.fn();
const mockDisconnect = vi.fn();

const loadComponent = async () => {
  process.env.NEXT_PUBLIC_AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL || "http://localhost";
  const mod = await import("@/components/auth/sign-in-form");
  return mod.SignInForm;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: null,
    isPending: false,
    walletAccountId: currentAuthState.walletAccountId,
    walletSignIn,
    walletSignOut,
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
  authClient: {
    requestSignIn: { near: (...args: any[]) => requestSignIn(...args) },
    signIn: { near: (...args: any[]) => signIn(...args) },
    near: { disconnect: (...args: any[]) => mockDisconnect(...args) },
    signOut: (...args: any[]) => mockSignOut(...args),
  },
}));

const currentAuthState = {
  walletAccountId: null as string | null,
};

const click = async (label: RegExp) =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });

describe("SignInForm", () => {
  beforeEach(async () => {
    toast = (await import("sonner")).toast as any;
    currentAuthState.walletAccountId = null;
    routerPush.mockReset();
    walletSignIn.mockReset();
    walletSignOut.mockReset();
    requestSignIn.mockReset();
    signIn.mockReset();
    mockSignOut.mockReset();
    mockDisconnect.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once on nonce error then succeeds", async () => {
    const SignInForm = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    walletSignIn.mockResolvedValue(undefined);
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

    render(<SignInForm />);
    await click(/sign in with hot wallet/i);

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(routerPush).toHaveBeenCalledWith("/");
  });

  it("surfaces network mismatch error", async () => {
    const SignInForm = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) =>
      handlers.onError?.({ code: "NETWORK_MISMATCH" })
    );

    render(<SignInForm />);
    await click(/sign in with hot wallet/i);

    expect(screen.getByText(/different network/i)).toBeInTheDocument();
  });

  it("handles user-rejected wallet connection errors gracefully", async () => {
    const SignInForm = await loadComponent();
    walletSignIn.mockRejectedValue(new Error("User rejected"));
    render(<SignInForm />);
    await click(/connect hot wallet/i);
    expect(requestSignIn).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Wallet connection cancelled");
  });

  it("surfaces sign-in cancellation without disconnecting", async () => {
    const SignInForm = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) =>
      handlers.onError?.(new Error("User rejected"))
    );

    render(<SignInForm />);
    await click(/sign in with hot wallet/i);

    expect(toast.error).toHaveBeenCalledWith("Wallet connection cancelled");
  });

  it("shows error banner after exhausting nonce retries", async () => {
    const SignInForm = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";
    requestSignIn.mockImplementation((_args, handlers) => handlers.onSuccess());
    signIn.mockImplementation((_args, handlers) => handlers.onError?.({ code: "NONCE_NOT_FOUND" }));

    render(<SignInForm />);
    await click(/sign in with hot wallet/i);

    expect(signIn).toHaveBeenCalledTimes(2); // initial + retry
    expect(screen.getByText(/authentication failed/i)).toBeInTheDocument();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(walletSignOut).toHaveBeenCalled();
  });

  it("disconnects wallets when user clicks disconnect", async () => {
    const SignInForm = await loadComponent();
    currentAuthState.walletAccountId = "alice.testnet";

    render(<SignInForm />);
    await click(/disconnect wallet/i);

    expect(mockSignOut).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
    expect(walletSignOut).toHaveBeenCalled();
  });
});
