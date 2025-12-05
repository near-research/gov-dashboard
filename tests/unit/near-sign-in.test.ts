import { nearSignInWithRetry } from "@/lib/auth/near-sign-in";
import { mockSession } from "../fixtures/context";
import { describe, expect, it, vi, afterEach } from "vitest";

const advanceTimers = async (ms: number) => {
  const anyVi = vi as any;
  if (anyVi.advanceTimersByTimeAsync) {
    await anyVi.advanceTimersByTimeAsync(ms);
    return;
  }
  anyVi.advanceTimersByTime?.(ms);
};

describe("nearSignInWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it("returns cancelled when wallet connection is rejected", async () => {
    const connectWallet = vi.fn().mockRejectedValue({
      code: "ACTION_REJECTED",
      message: "User rejected connection",
    });

    const result = await nearSignInWithRetry({
      walletAccountId: null,
      connectWallet,
      requestSignIn: vi.fn(),
      signIn: vi.fn(),
    });

    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "cancelled",
      message: "Wallet connection cancelled",
    });
  });

  it("backs off and retries when nonce is missing before succeeding", async () => {
    vi.useFakeTimers();
    const requestSignIn = vi.fn().mockResolvedValue(undefined);
    const signIn = vi
      .fn()
      .mockRejectedValueOnce({ code: "NONCE_NOT_FOUND" })
      .mockResolvedValueOnce(undefined);

    const resultPromise = nearSignInWithRetry({
      walletAccountId: mockSession.user.nearAccountId,
      connectWallet: vi.fn(),
      requestSignIn,
      signIn,
      maxRetries: 1,
      retryBaseDelayMs: 300,
    });

    await advanceTimers(300);
    const result = await resultPromise;

    expect(requestSignIn).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "success" });
  });

  it("disconnects after exhausting nonce retries", async () => {
    vi.useFakeTimers();
    const requestSignIn = vi.fn().mockResolvedValue(undefined);
    const signIn = vi.fn().mockRejectedValue({ code: "NONCE_NOT_FOUND" });
    const disconnectOnError = vi.fn().mockResolvedValue(undefined);

    const resultPromise = nearSignInWithRetry({
      walletAccountId: mockSession.user.nearAccountId,
      connectWallet: vi.fn(),
      requestSignIn,
      signIn,
      disconnectOnError,
      maxRetries: 1,
      retryBaseDelayMs: 150,
    });

    await advanceTimers(150);
    const result = await resultPromise;

    expect(requestSignIn).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledTimes(2);
    expect(disconnectOnError).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/authentication failed/i);
    } else {
      throw new Error("Expected error status");
    }
  });

  it("does not disconnect on user-rejected signature", async () => {
    const requestSignIn = vi.fn().mockResolvedValue(undefined);
    const signIn = vi.fn().mockRejectedValue({
      reason: "User cancelled signing",
    });
    const disconnectOnError = vi.fn();

    const result = await nearSignInWithRetry({
      walletAccountId: mockSession.user.nearAccountId,
      connectWallet: vi.fn(),
      requestSignIn,
      signIn,
      disconnectOnError,
    });

    expect(disconnectOnError).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "cancelled",
      message: "Wallet connection cancelled",
    });
  });

  it("returns a network-mismatch before invoking disconnect handlers", async () => {
    const requestSignIn = vi.fn().mockResolvedValue(undefined);
    const signIn = vi.fn().mockRejectedValue({ code: "NETWORK_MISMATCH" });
    const disconnectOnError = vi.fn().mockResolvedValue(undefined);

    const result = await nearSignInWithRetry({
      walletAccountId: mockSession.user.nearAccountId,
      connectWallet: vi.fn(),
      requestSignIn,
      signIn,
      disconnectOnError,
    });

    expect(disconnectOnError).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "network-mismatch",
      message: "Connected wallet is on a different network.",
    });
  });
});
