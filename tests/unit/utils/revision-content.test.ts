import { describe, expect, it } from "vitest";

import { buildRevisionView } from "@/components/proposal/hooks/useProposalDetail";
import { reconstructRevisionContent } from "@/utils/ui/revision-content";
import type { ProposalRevision } from "@/components/proposal/types/proposals";

const sideBySide = (before: string, after: string) => `
<div class="revision-content">
${before}
</div>
<div class="revision-content">
${after}
</div>
`;

describe("reconstructRevisionContent", () => {
  it("walks back through side-by-side diffs to rebuild older revisions", () => {
    const revisions = [
      {
        version: 3,
        body_changes: {
          side_by_side: sideBySide("<p>v2 body</p>", "<p>v3 body</p>"),
        },
        title_changes: {
          side_by_side: sideBySide("<p>v2 title</p>", "<p>v3 title</p>"),
        },
      },
      {
        version: 2,
        body_changes: {
          side_by_side: sideBySide("<p>v1 body</p>", "<p>v2 body</p>"),
        },
        title_changes: {
          side_by_side: sideBySide("<p>v1 title</p>", "<p>v2 title</p>"),
        },
      },
    ];

    const result = reconstructRevisionContent(
      "<p>v3 body</p>",
      "v3 title",
      revisions as unknown as ProposalRevision[],
      1
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("v1 body");
    expect(result.title).toContain("v1 title");
    expect(result.errors).toHaveLength(0);
  });

  it("returns failure when target is out of range", () => {
    const result = reconstructRevisionContent(
      "<p>current</p>",
      "current",
      [],
      3
    );

    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid target version/);
  });
});

describe("buildRevisionView", () => {
  it("falls back to base content when reconstruction fails", () => {
    const { content, diffHtml } = buildRevisionView([], "<p>base</p>", "base", 3);
    expect(content).toBe("<p>base</p>");
    expect(diffHtml).toBe("");
  });

  it("uses inline diff when present and keeps base content when reconstruction reports errors", () => {
    const revisions = [
      {
        version: 5,
        body_changes: {
          inline: "<ins>added</ins>",
        },
      },
    ];

    const { content, diffHtml } = buildRevisionView(
      revisions as unknown as ProposalRevision[],
      "<p>latest</p>",
      "latest",
      5
    );

    expect(content).toBe("<p>latest</p>");
    expect(diffHtml).toBe("<ins>added</ins>");
  });
});
