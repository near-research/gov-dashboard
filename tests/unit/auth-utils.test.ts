import {
  getLinkedProviders,
  getNearAccountId,
  getProviderConfig,
  handleAccountLinkRefresh,
  hasNearLinked,
} from "@/lib/auth-utils";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

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

  describe("getLinkedProviders", () => {
    it("returns a list of provider ids from linked accounts", () => {
      const linkedAccounts = [
        { providerId: "google", accountId: "alice" },
        { providerId: "github", accountId: "octocat" },
      ];

      expect(getLinkedProviders(linkedAccounts)).toEqual(["google", "github"]);
    });

    it("returns an empty array when no accounts provided", () => {
      expect(getLinkedProviders(undefined as any)).toEqual([]);
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
      expect(hasNearLinked([{ providerId: "github", accountId: "octocat" }])).toBe(
        false
      );
    });
  });

  describe("getProviderConfig", () => {
    it("returns predefined config for known providers", () => {
      expect(getProviderConfig("google").name).toBe("Google");
      expect(getProviderConfig("github").backgroundColor).toBe("bg-[#181717]");
      expect(getProviderConfig("siwn").icon).toBe("🔗");
    });

    it("falls back to a generic config for unknown providers", () => {
      expect(getProviderConfig("discord")).toMatchObject({
        name: "Discord",
        backgroundColor: "bg-gray-100",
      });
    });
  });

  describe("handleAccountLinkRefresh", () => {
    const refreshAccounts = vi.fn().mockResolvedValue(undefined);
    let fakeWindow: {
      location: { search: string; pathname: string; hash: string };
      history: { replaceState: ReturnType<typeof vi.fn> };
    };

    beforeEach(() => {
      refreshAccounts.mockClear();
      fakeWindow = {
        location: { search: "", pathname: "/", hash: "" },
        history: { replaceState: vi.fn() },
      };
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it("triggers immediate refresh and schedules cleanup when callback params exist", async () => {
      fakeWindow.location.search = "?code=abc";
      fakeWindow.location.hash = "#hash";

      handleAccountLinkRefresh(refreshAccounts, fakeWindow as any, 0);

      expect(refreshAccounts).toHaveBeenCalledTimes(1);
      expect(fakeWindow.history.replaceState).toHaveBeenCalledWith(
        null,
        "",
        "/#hash"
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccounts).toHaveBeenCalledTimes(2);
      expect(fakeWindow.location.search).toBe("?code=abc");
      expect(fakeWindow.location.hash).toBe("#hash");
    });

    it("returns refresher without scheduling when callback params are absent", async () => {
      fakeWindow.location.pathname = "/profile";

      const returned = handleAccountLinkRefresh(refreshAccounts, fakeWindow as any, 0);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshAccounts).toHaveBeenCalledTimes(1);
      expect(fakeWindow.history.replaceState).not.toHaveBeenCalled();
      expect(returned).toBe(refreshAccounts);
    });
  });
});
