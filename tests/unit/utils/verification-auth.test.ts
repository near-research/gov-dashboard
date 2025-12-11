import { describe, it, expect, vi, beforeEach } from "vitest";
import { createVerificationAuthToken } from "@/utils/verification/auth";

vi.mock("near-sign-verify", () => ({
  sign: vi.fn().mockResolvedValue("mock-signed-token"),
}));

vi.mock("@/config/siwn", () => ({
  siwnRecipient: "default-recipient",
}));

import { sign } from "near-sign-verify";

describe("createVerificationAuthToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates token with verificationId in message", async () => {
    const token = await createVerificationAuthToken({
      walletSigner: {} as any,
      verificationId: "test-verification-id",
    });

    expect(sign).toHaveBeenCalledWith(
      "Fetch verification proof test-verification-id",
      expect.objectContaining({
        recipient: "default-recipient",
      })
    );
    expect(token).toBe("mock-signed-token");
  });

  it("creates token without verificationId", async () => {
    const token = await createVerificationAuthToken({
      walletSigner: {} as any,
    });

    expect(sign).toHaveBeenCalledWith(
      "Fetch verification proof",
      expect.any(Object)
    );
    expect(token).toBe("mock-signed-token");
  });

  it("uses custom recipient when provided", async () => {
    await createVerificationAuthToken({
      walletSigner: {} as any,
      recipient: "custom-recipient",
    });

    expect(sign).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        recipient: "custom-recipient",
      })
    );
  });
});
