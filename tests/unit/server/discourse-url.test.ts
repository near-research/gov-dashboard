import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeFileSchemeUrl } from "@/server/plugins/discourse-url";

describe("normalizeFileSchemeUrl", () => {
  it("leaves https URLs unchanged", () => {
    expect(
      normalizeFileSchemeUrl("https://gov.near.org/t/123-proposal")
    ).toBe("https://gov.near.org/t/123-proposal");
  });

  it("retains file URLs that already include three slashes", () => {
    expect(normalizeFileSchemeUrl("file:///tmp/discourse-export.json")).toBe(
      "file:///tmp/discourse-export.json"
    );
  });

  it("adds the missing slash for file:// URLs", () => {
    expect(normalizeFileSchemeUrl("file://tmp/discourse-export.json")).toBe(
      "file:///tmp/discourse-export.json"
    );
  });
});
