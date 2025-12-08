import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscourseConnect } from "@/components/profile/DiscourseConnect";

const { render, screen, fireEvent, act, waitFor } = await import("@testing-library/react");

const getUserApiAuthUrl = vi.fn();
const completeLink = vi.fn();
const onLinked = vi.fn();
const onError = vi.fn();

const wallet = { signMessage: vi.fn() } as any;

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    wallet,
    nearClient: wallet,
    nearAccountId: "alice.testnet",
  }),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    discourse: {
      getUserApiAuthUrl: (...args: any[]) => getUserApiAuthUrl(...args),
      completeLink: (...args: any[]) => completeLink(...args),
    },
  },
}));

vi.mock("near-sign-verify", () => ({
  sign: vi.fn(async () => "auth-token"),
}));

describe("DiscourseConnect", () => {
  let openSpy: any;

  beforeEach(() => {
    getUserApiAuthUrl.mockReset();
    completeLink.mockReset();
    onLinked.mockReset();
    onError.mockReset();
    openSpy = vi.spyOn(window, "open");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces popup blocked error", async () => {
    getUserApiAuthUrl.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
    openSpy.mockReturnValue(null);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i })));

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i));
  });

  it("reports popup closed before completion", async () => {
    getUserApiAuthUrl.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
    const popup = { closed: true, close: vi.fn() } as any;
    openSpy.mockReturnValue(popup);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i })));

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i));
  });

  it("resets state after successful completion", async () => {
    getUserApiAuthUrl.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
    completeLink.mockResolvedValue({ nearAccount: "alice", discourseUsername: "bob" });
    const popup = { closed: false, close: vi.fn() } as any;
    openSpy.mockReturnValue(popup);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i })));

    const textarea = await screen.findByRole("textbox");
    await act(async () => fireEvent.change(textarea, { target: { value: "key" } }));

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /complete link/i }))
    );

    expect(onLinked).toHaveBeenCalledWith(
      expect.objectContaining({ discourseUsername: "bob" })
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /connect to discourse/i })).toBeInTheDocument()
    );
  });
});
