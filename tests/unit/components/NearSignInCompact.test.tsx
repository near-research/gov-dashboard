import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { render, screen, fireEvent, act } = await import("@testing-library/react");
let toast: any;

const walletSignIn = vi.fn();
const walletSignOut = vi.fn();

const currentAuthState = {
  user: null as null | { id: string },
  isPending: false,
  nearAccountId: null as string | null,
  walletAccountId: null as string | null,
};

const loadComponent = async () => {
  const mod = await import("@/components/auth/near-sign-in-compact");
  return mod.NearSignInCompact;
};

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    user: currentAuthState.user,
    isPending: currentAuthState.isPending,
    nearAccountId: currentAuthState.nearAccountId,
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

describe("NearSignInCompact", () => {
  beforeEach(async () => {
    toast = (await import("sonner")).toast as any;
    currentAuthState.user = null;
    currentAuthState.isPending = false;
    currentAuthState.nearAccountId = null;
    currentAuthState.walletAccountId = null;
    walletSignIn.mockReset();
    walletSignOut.mockReset();
  });

  const clickSignIn = async () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    });

  it("renders loading indicator while pending", async () => {
    currentAuthState.isPending = true;
    const NearSignInCompact = await loadComponent();

    render(<NearSignInCompact />);

    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("calls walletSignIn and shows success toast", async () => {
    const NearSignInCompact = await loadComponent();
    walletSignIn.mockResolvedValue(undefined);

    render(<NearSignInCompact />);
    await clickSignIn();

    expect(walletSignIn).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Signed in");
  });

  it("shows account info when authenticated", async () => {
    currentAuthState.user = { id: "user-1" };
    currentAuthState.nearAccountId = "alice.near";
    currentAuthState.walletAccountId = "bob.near";
    const NearSignInCompact = await loadComponent();

    render(<NearSignInCompact />);

    expect(screen.getByText("alice.near")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("signs out via walletSignOut", async () => {
    currentAuthState.user = { id: "user-1" };
    const NearSignInCompact = await loadComponent();
    walletSignOut.mockResolvedValue(undefined);

    render(<NearSignInCompact />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    });

    expect(walletSignOut).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Signed out");
  });

  it("shows toast error when non-cancelled rejection occurs", async () => {
    const NearSignInCompact = await loadComponent();
    walletSignIn.mockRejectedValue(new Error("boom"));

    render(<NearSignInCompact />);
    await clickSignIn();

    expect(toast.error).toHaveBeenCalledWith("boom");
  });
});
