import { getNearAccountId, hasNearLinked } from "@/lib/auth/auth-utils";
import { describe, it, expect } from "vitest";

describe("auth-utils", () => {
  describe("getNearAccountId", () => {
    it("returns the NEAR account id before provider suffix", () => {
      const linkedAccounts = [
        { providerId: "github", accountId: "octocat" },
        { providerId: "siwn", accountId: "user.near:wallet" },
      ];

      expect(getNearAccountId(linkedAccounts)).toBe("user.near");
    });

    it("returns null when no NEAR account is linked", () => {
      const linkedAccounts = [{ providerId: "google", accountId: "alice" }];

      expect(getNearAccountId(linkedAccounts)).toBeNull();
    });
  });


  describe("hasNearLinked", () => {
    it("returns true when a NEAR account is linked", () => {
      const linkedAccounts = [
        { providerId: "google", accountId: "alice" },
        { providerId: "siwn", accountId: "bob.near" },
      ];

      expect(hasNearLinked(linkedAccounts)).toBe(true);
    });

    it("returns false when NEAR provider is missing or empty", () => {
      expect(hasNearLinked([{ providerId: "siwn", accountId: "" }])).toBe(
        false
      );
      expect(
        hasNearLinked([{ providerId: "github", accountId: "octocat" }])
      ).toBe(false);
    });
  });

});
