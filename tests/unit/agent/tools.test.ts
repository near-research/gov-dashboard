import { describe, expect, it } from "vitest";
import { safeParseToolArgs } from "@/pages/api/agent/server/tool-args";

describe("safeParseToolArgs", () => {
  it("parses valid JSON arguments", () => {
    const result = safeParseToolArgs('{"title":"Test","content":"Body"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Test");
      expect(result.value.content).toBe("Body");
    }
  });

  it("returns error for invalid JSON", () => {
    const result = safeParseToolArgs("{ invalid json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
