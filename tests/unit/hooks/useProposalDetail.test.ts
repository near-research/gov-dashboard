import "../../vi-compat";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { DiscourseRevisionResponse } from "@/types/discourse";
import type { ProposalDetailResponse } from "@/types/proposals";
import { useProposalDetail } from "@/hooks/useProposalDetail";
import type { Evaluation } from "@/types/evaluation";

const PROPOSAL_ID = "proposal-100";

type MockResponseConfig<T> = {
  body?: T;
  ok?: boolean;
  status?: number;
  throwError?: unknown;
};

interface FetchScenario {
  proposal?: MockResponseConfig<ProposalDetailResponse>;
  revisions?: MockResponseConfig<DiscourseRevisionResponse>;
  screenings?: Record<number, MockResponseConfig<Record<string, unknown>>>;
}

const baseEvaluation: Evaluation = {
  complete: { pass: true, reason: "complete" },
  legible: { pass: true, reason: "legible" },
  consistent: { pass: true, reason: "consistent" },
  compliant: { pass: true, reason: "compliant" },
  justified: { pass: true, reason: "justified" },
  measurable: { pass: true, reason: "measurable" },
  relevant: { score: "high", reason: "relevant" },
  material: { score: "high", reason: "material" },
  qualityScore: 0.9,
  attentionScore: 0.7,
  overallPass: true,
  summary: "validated",
  model: "evaluation-model",
};

const defaultProposalResponse = (overrides: Partial<ProposalDetailResponse> = {}): ProposalDetailResponse => ({
  id: 1,
  title: "Proposal Title",
  content: "<p>Full content</p>",
  contentWithoutFrontmatter: "<p>Clean content</p>",
  metadata: { category: "governance" },
  version: 1,
  created_at: "2024-01-01T00:00:00Z",
  username: "creator.near",
  topic_id: 123,
  topic_slug: "topic-slug",
  reply_count: 0,
  views: 10,
  last_posted_at: "2024-01-02T00:00:00Z",
  ...overrides,
});

const defaultScreeningPayload = (
  revision = 1,
  override: Record<string, unknown> = {}
) => ({
  evaluation: { ...baseEvaluation },
  title: `analysis-${revision}`,
  nearAccount: "screening.near",
  timestamp: "2024-02-01T00:00:00Z",
  revisionNumber: revision,
  qualityScore: 0.8,
  attentionScore: 0.6,
  ...override,
});

const defaultRevisionsResponse = (
  latest = 1,
  revisions: DiscourseRevisionResponse["revisions"] = []
): DiscourseRevisionResponse => ({
  post_id: 1,
  current_version: latest,
  total_revisions: revisions.length,
  revisions,
});

const fetchMock = vi.fn();

const resolveFetch = <T>(
  config: MockResponseConfig<T>,
  fallback: T
): Promise<{ ok: boolean; status: number; json: () => Promise<T> }> => {
  if (config.throwError) {
    return Promise.reject(config.throwError);
  }
  const ok = config.ok ?? true;
  const status = config.status ?? (ok ? 200 : 500);
  const body = config.body ?? fallback;
  return Promise.resolve({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
};

const extractRevisionNumber = (url: string) => {
  const match = url.match(/revisionNumber=(\d+)/);
  return match ? Number(match[1]) : 1;
};

const setupFetchScenario = (scenario: FetchScenario = {}) => {
  const proposal = defaultProposalResponse();
  const revisions = defaultRevisionsResponse(1);

  fetchMock.mockImplementation((input: RequestInfo) => {
    const url = typeof input === "string" ? input : input.url;

    if (url.includes(`/api/proposals/${PROPOSAL_ID}/revisions`)) {
      return resolveFetch(scenario.revisions ?? { body: revisions }, revisions);
    }

    if (url.includes("/api/getAnalysis/")) {
      const revision = extractRevisionNumber(url);
      const screeningOverride =
        scenario.screenings?.[revision] ?? { body: defaultScreeningPayload(revision) };
      return resolveFetch(
        screeningOverride,
        defaultScreeningPayload(revision)
      );
    }

    if (url.includes(`/api/proposals/${PROPOSAL_ID}`)) {
      return resolveFetch(
        scenario.proposal ?? { body: proposal },
        proposal
      );
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    });
  });
};

describe("useProposalDetail", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals?.();
  });

  it("loads proposal and screening data with normalized model", async () => {
    const trackMock = vi.fn();
    setupFetchScenario();

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: trackMock })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposal?.title).toBe("Proposal Title");
    expect(result.current.versionContent).toBe("<p>Clean content</p>");
    expect(result.current.versionDiffHtml).toBe("");
    expect(result.current.screeningChecked).toBe(true);
    expect(result.current.screening?.model).toBe("evaluation-model");
    expect(trackMock).toHaveBeenCalledWith(
      "proposal_viewed",
      expect.objectContaining({
        props: expect.objectContaining({ topic_id: PROPOSAL_ID }),
      })
    );
  });

  it("handles empty proposal content without crashing", async () => {
    setupFetchScenario({
      proposal: { body: defaultProposalResponse({ contentWithoutFrontmatter: "", title: "" }) },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.versionContent).toBe("");
    expect(result.current.versionDiffHtml).toBe("");
  });

  it("surfaces error when proposal fetch fails", async () => {
    setupFetchScenario({
      proposal: { ok: false, status: 500 },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch proposal");
    expect(result.current.proposal).toBeNull();
    expect(result.current.screening).toBeNull();
  });

  it("ignores abort errors when fetching the proposal", async () => {
    const abortError = new DOMException(
      "signal is aborted without reason",
      "AbortError"
    );

    setupFetchScenario({
      proposal: { throwError: abortError },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("");
    expect(result.current.proposal).toBeNull();
  });

  it("refetches screening when version changes and surfaces errors", async () => {
    const trackMock = vi.fn();
    setupFetchScenario({
      screenings: {
        2: { throwError: new Error("Timeout") },
      },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: trackMock })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleVersionChange(2);
    });

    const analysisCalls = fetchMock.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("/api/getAnalysis/")
    );
    expect(analysisCalls.length).toBeGreaterThanOrEqual(2);
    expect(analysisCalls[analysisCalls.length - 1][0]).toContain("revisionNumber=2");
    expect(result.current.screeningChecked).toBe(false);
    expect(trackMock).toHaveBeenCalledWith(
      "proposal_screening_failed",
      expect.objectContaining({
        props: expect.objectContaining({ topic_id: PROPOSAL_ID, revision: 2 }),
      })
    );
  });

  it("treats 404 screening responses as checked but empty", async () => {
    setupFetchScenario({
      screenings: {
        2: { ok: false, status: 404 },
      },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchScreening(PROPOSAL_ID, 2);
    });

    await waitFor(() => expect(result.current.screeningChecked).toBe(true));
    expect(result.current.screening).toBeNull();
  });

  it("fetches revisions when toggled and updates selection", async () => {
    const revisionsPayload = defaultRevisionsResponse(2, [
      {
        version: 1,
        created_at: "2024-01-01T00:00:00Z",
        username: "editor.near",
        body_changes: { inline: "<p>diff</p>" },
      },
    ]);

    setupFetchScenario({
      revisions: { body: revisionsPayload },
      screenings: {
        2: { body: defaultScreeningPayload(2) },
      },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleToggleRevisions();
    });

    await waitFor(() => expect(result.current.revisions.length).toBe(1));
    expect(result.current.currentRevision).toBe(2);
    expect(result.current.selectedVersion).toBe(2);
    expect(result.current.showRevisions).toBe(true);
  });

  it("handles revision fetch failures without breaking UI", async () => {
    setupFetchScenario({
      revisions: { throwError: new Error("Timeout") },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleToggleRevisions();
    });

    expect(result.current.error).toBe("Timeout");
    expect(result.current.revisions).toEqual([]);
    expect(result.current.showRevisions).toBe(true);
  });

  it("handles revisions response without a list by clearing revisions", async () => {
    const incompleteRevisions = {
      post_id: 2,
      current_version: 1,
      total_revisions: 0,
      revisions: undefined,
    } as unknown as DiscourseRevisionResponse;

    setupFetchScenario({
      revisions: { body: incompleteRevisions },
    });

    const { result } = renderHook(() =>
      useProposalDetail({ proposalId: PROPOSAL_ID, track: vi.fn() })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleToggleRevisions();
    });

    expect(result.current.revisions).toEqual([]);
    expect(result.current.currentRevision).toBe(1);
    expect(result.current.selectedVersion).toBe(1);
  });
});
