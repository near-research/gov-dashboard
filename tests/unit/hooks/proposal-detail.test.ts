import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProposalRevision } from "@/components/proposal/types/proposals";
import { buildRevisionView } from "@/components/proposal/hooks/useProposalDetail";
import { reconstructRevisionContent } from "@/utils/ui/revision-content";

vi.mock("@/utils/ui/revision-content", () => ({
  reconstructRevisionContent: vi.fn(),
}));

const mockedReconstruct = vi.mocked(reconstructRevisionContent);

describe("buildRevisionView", () => {
  const baseContent = "<p>current</p>";
  const baseTitle = "Current Title";

  const revisions: ProposalRevision[] = [
    {
      version: 2,
      created_at: "2024-01-01T00:00:00Z",
      username: "editor@near",
      body_changes: {
        inline: "<div>diff-1</div>",
      },
    },
  ];

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns base content when version is 1", () => {
    const result = buildRevisionView(revisions, baseContent, baseTitle, 1);

    expect(result).toEqual({
      content: baseContent,
      diffHtml: "",
    });
    expect(mockedReconstruct).not.toHaveBeenCalled();
  });

  it("uses reconstructed content when available", () => {
    mockedReconstruct.mockReturnValueOnce({
      content: "<p>reconstructed</p>",
      title: "Reconstructed Title",
      success: true,
      errors: [],
    });

    const result = buildRevisionView(
      revisions,
      baseContent,
      baseTitle,
      2
    );

    expect(result.content).toBe("<p>reconstructed</p>");
    expect(result.diffHtml).toBe("<div>diff-1</div>");
    expect(mockedReconstruct).toHaveBeenCalledWith(
      baseContent,
      baseTitle,
      revisions,
      2
    );
  });

  it("falls back to base content when reconstruction fails", () => {
    mockedReconstruct.mockReturnValueOnce({
      content: "<p>reconstructed</p>",
      title: "Reconstructed Title",
      success: false,
      errors: ["invalid version"],
    });

    const result = buildRevisionView(
      revisions,
      baseContent,
      baseTitle,
      2
    );

    expect(result.content).toBe(baseContent);
    expect(result.diffHtml).toBe("<div>diff-1</div>");
  });
});
