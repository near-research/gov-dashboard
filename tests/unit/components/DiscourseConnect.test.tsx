import "../../vi-compat";
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscourseConnect } from "@/components/profile/DiscourseConnect";

const { render, screen, fireEvent, act, waitFor } = await import("@testing-library/react");

const initiateLink = vi.fn();
const completeLink = vi.fn();
const onLinked = vi.fn();
const onError = vi.fn();

const wallet = { signMessage: vi.fn() } as any;

let mockNearAccountId: string | null = "alice.testnet";
let mockNearClient: any = wallet;

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({
    nearClient: mockNearClient,
    nearAccountId: mockNearAccountId,
  }),
}));

vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    near: {
      getNearClient: () => mockNearClient,
      getAccountId: () => mockNearAccountId,
    },
  },
}));

vi.mock("@/lib/orpc", () => ({
  client: {
      discourse: {
        initiateLink: (...args: any[]) => initiateLink(...args),
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
    mockNearAccountId = "alice.testnet";
    mockNearClient = wallet;

    initiateLink.mockReset();
    completeLink.mockReset();
    onLinked.mockReset();
    onError.mockReset();
    openSpy = vi.spyOn(window, "open");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prompts the user to connect a wallet when none is present", () => {
    mockNearAccountId = null;

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);

    expect(screen.getByTestId("discourse-wallet-warning")).toHaveTextContent(
      /connect your near wallet to discourse/i
    );

    expect(
      screen.queryByRole("button", { name: /connect to discourse/i })
    ).not.toBeInTheDocument();
  });

  it("shows pending linking instructions and fallback tooltip button when wallet connected", async () => {
    initiateLink.mockResolvedValue({
      authUrl: "https://discourse",
      nonce: "n1",
    });
    const popup = { closed: false, close: vi.fn() } as any;
    openSpy.mockReturnValue(popup);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i }));
    });

    expect(
      await screen.findByText(/Complete Discourse Linking/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Authorize the connection in the newly opened Discourse tab\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /reopen discourse authorization/i,
      })
    ).toBeInTheDocument();
  });

  it("surfaces popup blocked error", async () => {
    initiateLink.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
    openSpy.mockReturnValue(null);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i })));

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i));
  });

  it("reports popup closed before completion", async () => {
    initiateLink.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
    const popup = { closed: true, close: vi.fn() } as any;
    openSpy.mockReturnValue(popup);

    render(<DiscourseConnect onLinked={onLinked} onError={onError} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /connect to discourse/i })));

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/popup blocked/i));
  });

  it("resets state after successful completion", async () => {
    initiateLink.mockResolvedValue({ authUrl: "https://discourse", nonce: "n1" });
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
