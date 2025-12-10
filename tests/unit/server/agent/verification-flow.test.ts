import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerSecondVerificationSession,
  finalizeVerifications,
} from "@/server/agent/verification-flow";
import { getNearAIClient } from "@/lib/near-ai";

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
    const client = getNearAIClient();
    const createSessionSpy = vi.spyOn(client, "createSession");
    const updateHashesSpy = vi.spyOn(client, "updateSessionHashes");

    const result = await registerSecondVerificationSession(
      baseUrl,
      "base-id",
      "request-hash"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/verification/session`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ verificationId: "base-id-synthesis" }),
      })
    );
    expect(createSessionSpy).toHaveBeenCalledWith(
      "base-id-synthesis",
      "second-nonce"
    );
    expect(updateHashesSpy).toHaveBeenCalledWith("base-id-synthesis", {
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
    const client = getNearAIClient();
    const createSessionSpy = vi.spyOn(client, "createSession");
    const updateHashesSpy = vi.spyOn(client, "updateSessionHashes");

    const result = await registerSecondVerificationSession(
      baseUrl,
      "base-ok",
      "req"
    );

    expect(createSessionSpy).toHaveBeenCalledWith("base-ok-synthesis", undefined);
    expect(updateHashesSpy).toHaveBeenCalledWith("base-ok-synthesis", {
      requestHash: "req",
    });
    expect(result.secondNonce).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("emits verification events when canonical hashes are available", async () => {
    const client = getNearAIClient();
    const canonicalSpy = vi
      .spyOn(client, "fetchCanonicalHashes")
      .mockResolvedValueOnce({
        requestHash: "req-hash-1",
        responseHash: "res-hash-1",
      })
      .mockResolvedValueOnce({
        requestHash: "req-hash-2",
        responseHash: "res-hash-2",
      });
    const updateHashSpy = vi.spyOn(client, "updateSessionHashes");

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

    expect(canonicalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackId: "init-ver",
        remoteMessageId: "remote-init",
        model: expect.any(String),
        signingAlgo: "ed25519",
      })
    );
    expect(canonicalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackId: "second-ver",
        remoteMessageId: "remote-second",
        model: expect.any(String),
        signingAlgo: "ed25519",
      })
    );

    expect(updateHashSpy).toHaveBeenCalledWith("init-ver", {
      requestHash: "req-hash-1",
      responseHash: "res-hash-1",
    });
    expect(updateHashSpy).toHaveBeenCalledWith("second-ver", {
      requestHash: "req-hash-2",
      responseHash: "res-hash-2",
    });

    expect(writeEvent).toHaveBeenCalledTimes(2);
    expect(writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        name: "verification",
        value: expect.objectContaining({
          verificationId: "init-ver",
          requestHash: "req-hash-1",
          responseHash: "res-hash-1",
          stage: "initial_reasoning",
        }),
      })
    );
  });

  it("logs warnings instead of emitting events when canonical hashes are missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = getNearAIClient();
    const canonicalSpy = vi
      .spyOn(client, "fetchCanonicalHashes")
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

    canonicalSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
