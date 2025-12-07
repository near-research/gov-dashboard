import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerSecondVerificationSession,
  finalizeVerifications,
} from "@/server/agent/verification-flow";
import { verificationService } from "@/verification/server";

describe("agent verification flow", () => {
  const baseUrl = "https://runtime.example.com";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a second verification session and calls registerSession on success", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ nonce: "second-nonce" }),
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const registerSpy = vi
      .spyOn(verificationService, "registerSession")
      .mockImplementation(() => ({} as any));

    const result = await registerSecondVerificationSession(
      baseUrl,
      "base-id",
      "request-hash"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/verification/register-session`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verificationId: "base-id-synthesis" }),
      })
    );
    expect(registerSpy).toHaveBeenCalledWith({
      verificationId: "base-id-synthesis",
      nonce: "second-nonce",
      requestHash: "request-hash",
    });
    expect(result).toEqual({
      secondVerificationId: "base-id-synthesis",
      secondNonce: "second-nonce",
    });
  });

  it("still registers session even when the fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const registerSpy = vi
      .spyOn(verificationService, "registerSession")
      .mockImplementation(() => ({} as any));

    const result = await registerSecondVerificationSession(
      baseUrl,
      "base-ok",
      "req"
    );

    expect(registerSpy).toHaveBeenCalledWith({
      verificationId: "base-ok-synthesis",
      nonce: undefined,
      requestHash: "req",
    });
    expect(result.secondNonce).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("emits verification events when finalizeStage returns payloads", async () => {
    const initialPayload = { verificationId: "init" };
    const secondPayload = { verificationId: "second" };
    const finalizeSpy = vi
      .spyOn(verificationService, "finalizeStage")
      .mockResolvedValueOnce(initialPayload as any)
      .mockResolvedValueOnce(secondPayload as any);

    const writeEvent = vi.fn();

    await finalizeVerifications({
      initialVerificationId: "init-ver",
      initialRemoteId: "remote-init",
      initialNonce: "nonce1",
      secondVerificationId: "second-ver",
      secondRemoteVerificationId: "remote-second",
      secondNonce: "nonce2",
      signingAlgo: "ed25519",
      writeEvent,
    });

    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: "init-ver",
        stage: "initial_reasoning",
        nonce: "nonce1",
        remoteMessageId: "remote-init",
        signingAlgo: "ed25519",
      })
    );
    expect(finalizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationId: "second-ver",
        stage: "final_synthesis",
        nonce: "nonce2",
        remoteMessageId: "remote-second",
        signingAlgo: "ed25519",
      })
    );

    expect(writeEvent).toHaveBeenCalledTimes(2);
    expect(writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        name: "verification",
        value: initialPayload,
      })
    );
  });

  it("logs warnings instead of emitting events when finalizeStage yields nothing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const finalizeSpy = vi
      .spyOn(verificationService, "finalizeStage")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const writeEvent = vi.fn();

    await finalizeVerifications({
      initialVerificationId: "init",
      initialRemoteId: "remote-init",
      secondVerificationId: "second",
      secondRemoteVerificationId: "remote-second",
      writeEvent,
    });

    expect(writeEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[verification][agent] Unable to fetch canonical hashes for initial reasoning",
      expect.objectContaining({
        initialVerificationId: "init",
        initialRemoteId: "remote-init",
      })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[verification][agent] Unable to fetch canonical hashes for second completion",
      expect.objectContaining({
        secondVerificationId: "second",
        secondRemoteVerificationId: "remote-second",
      })
    );

    finalizeSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
