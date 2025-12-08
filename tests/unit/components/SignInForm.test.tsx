import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { render, fireEvent, screen, act } = await import("@testing-library/react");
let toast: any;

const routerPush = vi.fn();
const walletSignIn = vi.fn();
const walletSignOut = vi.fn();

const currentAuthState = {
  user: null as null | { id: string },
  isPending: false,
  walletAccountId: null as string | null,
};

const loadComponent = async () => {
  const mod = await import("@/components/auth/sign-in-form");
  return mod.SignInForm;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: currentAuthState.user,
    isPending: currentAuthState.isPending,
    walletAccountId: currentAuthState.walletAccountId,
    walletSignIn,
    walletSignOut,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SignInForm", () => {
  beforeEach(async () => {
    toast = (await import("sonner")).toast as any;
    currentAuthState.user = null;
    currentAuthState.isPending = false;
    currentAuthState.walletAccountId = null;
    routerPush.mockReset();
    walletSignIn.mockReset();
    walletSignOut.mockReset();
  });

  const clickButton = async () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    });

  it("redirects when session already exists", async () => {
    currentAuthState.user = { id: "user-1" };
    const SignInForm = await loadComponent();

    render(<SignInForm />);

    expect(routerPush).toHaveBeenCalledWith("/");
  });

  it("performs full SIWN flow and shows success toast", async () => {
    const SignInForm = await loadComponent();
    walletSignIn.mockResolvedValue(undefined);

    render(<SignInForm />);
    await clickButton();

    expect(walletSignIn).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Signed in successfully");
  });

  it("shows cancellation message when user rejects", async () => {
    const SignInForm = await loadComponent();
    walletSignIn.mockRejectedValue(new Error("User rejected"));

    render(<SignInForm />);
    await clickButton();

    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText(/sign in cancelled/i)).toBeInTheDocument();
  });

});
