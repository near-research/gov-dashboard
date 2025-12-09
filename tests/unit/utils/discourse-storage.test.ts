import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscourseUserApiKey,
  getDiscourseUserApiKey,
  saveDiscourseUserApiKey,
} from "@/utils/discourse/storage";

describe("Discourse storage helpers", () => {
  let localStorageMock: Record<string, any>;

  beforeEach(() => {
    localStorageMock = {
      setItem: vi.fn(),
      getItem: vi.fn(),
      removeItem: vi.fn(),
    };
    (globalThis as any).window = { localStorage: localStorageMock };
  });

  it("trims and stores a user API key", () => {
    saveDiscourseUserApiKey("  trimmed-key  ");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "discourseUserApiKey",
      "trimmed-key"
    );
    localStorageMock.getItem.mockReturnValue("trimmed-key");
    expect(getDiscourseUserApiKey()).toBe("trimmed-key");
  });

  it("removes the key when passed an empty value", () => {
    saveDiscourseUserApiKey("   ");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      "discourseUserApiKey"
    );
  });

  it("clears the stored key", () => {
    clearDiscourseUserApiKey();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      "discourseUserApiKey"
    );
  });

  it("survives storage errors without throwing", () => {
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("nope");
    });
    expect(() => saveDiscourseUserApiKey("any")).not.toThrow();
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("bad");
    });
    expect(getDiscourseUserApiKey()).toBeNull();
  });

  it("returns null when window is undefined", () => {
    delete (globalThis as any).window;
    expect(getDiscourseUserApiKey()).toBeNull();
  });
});
