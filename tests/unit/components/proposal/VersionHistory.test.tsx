import "../../../vi-compat";
import type { Evaluation } from "@/types/evaluation";
import type { DiscourseRevisionResponse } from "@/types/discourse";
import VersionHistory from "@/components/proposal/revisions/VersionHistory";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  useGovernanceAnalytics: () => trackMock,
}));

let mockSignedAccountId: string | null = "alice.testnet";
let mockWalletSigner: any = { signMessage: vi.fn() };
vi.mock("@/hooks/useNear", () => ({
  useNear: () => ({
    signedAccountId: mockSignedAccountId,
    walletSigner: mockWalletSigner,
  }),
}));

const { signMock } = vi.hoisted(() => ({
  signMock: vi.fn(),
}));

vi.mock("near-sign-verify", () => ({
  sign: signMock,
}));

const proposalId = "proposal-123";

const baseRevisionResponse: DiscourseRevisionResponse = {
  post_id: 1,
  total_revisions: 2,
  current_version: 2,
  revisions: [
    {
      version: 2,
      created_at: "2024-01-02T00:00:00.000Z",
      username: "editor-two",
      edit_reason: "Updated the summary",
      body_changes: { inline: "<p>Updated body</p>" },
      title_changes: { inline: "Tweaked Title" },
    },
    {
      version: 1,
      created_at: "2024-01-01T00:00:00.000Z",
      username: "editor-one",
    },
  ],
};

const createEvaluationFixture = (): Evaluation => ({
  complete: { pass: true, reason: "complete" },
  legible: { pass: true, reason: "legible" },
  consistent: { pass: true, reason: "consistent" },
  compliant: { pass: true, reason: "compliant" },
  justified: { pass: true, reason: "justified" },
  measurable: { pass: true, reason: "measurable" },
  relevant: { score: "high", reason: "relevant" },
  material: { score: "medium", reason: "material" },
  qualityScore: 0.9,
  attentionScore: 0.75,
  overallPass: true,
  summary: "Looks solid",
  model: "ai-model",
});

const defaultScreeningPayload = (
  revision = 1,
  override: Record<string, unknown> = {}
) => ({
  evaluation: createEvaluationFixture(),
  title: `analysis-${revision}`,
  nearAccount: "screening.near",
  timestamp: "2024-02-01T00:00:00Z",
  revisionNumber: revision,
  qualityScore: 0.8,
  attentionScore: 0.6,
  ...override,
});

const renderComponent = () =>
  render(
    <VersionHistory
      proposalId={proposalId}
      title="Original Title"
      content="<p>Original content</p>"
    />
  );

beforeEach(() => {
  vi.resetAllMocks();
  mockSignedAccountId = "alice.testnet";
  mockWalletSigner = { signMessage: vi.fn() };
  signMock.mockReset();
  signMock.mockResolvedValue("auth-token");
  trackMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const defaultSaveResponseBody = {
  evaluation: createEvaluationFixture(),
  verification: null,
  verificationId: null,
  model: "ai-model",
};

const stubFetch = ({
  revisions = baseRevisionResponse,
  saveAnalysisResponse = {
    ok: true,
    status: 200,
    body: defaultSaveResponseBody,
  },
  saveAnalysisReject,
  getAnalysisOk = false,
  delaySave,
}: {
  revisions?: DiscourseRevisionResponse;
  saveAnalysisResponse?: {
    ok: boolean;
    status: number;
    body: Record<string, unknown>;
  };
  saveAnalysisReject?: Error;
  getAnalysisOk?: boolean;
  delaySave?: Promise<void>;
} = {}) => {
  const fetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : typeof input === "object" ? input.url : "";

    if (url.includes(`/api/proposals/${proposalId}/revisions`)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => revisions,
      });
    }

    if (url.includes("/api/getAnalysis")) {
      const payload = defaultScreeningPayload();
      return Promise.resolve({
        ok: getAnalysisOk,
        status: 200,
        json: async () => ({
          results: [payload],
          screenings: [payload],
          hasMore: false,
        }),
      });
    }

    if (url.includes(`/api/saveAnalysis/${proposalId}`)) {
      if (saveAnalysisReject) {
        return Promise.reject(saveAnalysisReject);
      }

      const response = {
        ok: saveAnalysisResponse.ok,
        status: saveAnalysisResponse.status,
        json: async () => saveAnalysisResponse.body,
      };

      if (delaySave) {
        return delaySave.then(() => response);
      }

      return Promise.resolve(response);
    }

    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const openHistoryWithRevisions = async (waitForText = /Revision 2 of 2/i) => {
  fireEvent.click(screen.getByRole("button", { name: /show history/i }));
  await waitFor(() => expect(screen.getByText(waitForText)).toBeInTheDocument());
};

describe("VersionHistory", () => {
  describe("rendering", () => {
    it("fetches and displays revision history on mount", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/proposals/${proposalId}/revisions`
      );
      expect(
        screen.getByText(/Revision 2 of 2/i, { selector: "span" })
      ).toBeInTheDocument();
      expect(screen.getByText(/Original Version \(v1\)/i)).toBeInTheDocument();
    });

    it("shows loading state while fetching revisions", async () => {
      let resolveRevisions!: (value: {
        ok: boolean;
        status: number;
        json: () => Promise<DiscourseRevisionResponse>;
      }) => void;

      const revisionPromise = new Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<DiscourseRevisionResponse>;
      }>((resolve) => {
        resolveRevisions = resolve;
      });

      const fetchMock = vi.fn((input: RequestInfo) => {
        const url =
          typeof input === "string"
            ? input
            : typeof input === "object"
            ? input.url
            : "";

        if (url.includes(`/api/proposals/${proposalId}/revisions`)) {
          return revisionPromise;
        }

        if (url.includes("/api/getAnalysis")) {
          return Promise.resolve({
            ok: false,
            status: 200,
            json: async () => ({}),
          });
        }

        return Promise.reject(new Error(`Unexpected fetch to ${url}`));
      });

      vi.stubGlobal("fetch", fetchMock);
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: /show history/i })
      );

      expect(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument();

      resolveRevisions({
        ok: true,
        status: 200,
        json: async () => baseRevisionResponse,
      });

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });

    it("handles empty revision history", async () => {
      const emptyResponse = { ...baseRevisionResponse, revisions: [] };
      const fetchMock = stubFetch({ revisions: emptyResponse });
      renderComponent();

        fireEvent.click(
          screen.getByRole("button", { name: /show history/i })
        );

      await waitFor(() =>
        expect(
          screen.getByText(
            /No edit history available - this is the original version/i
          )
        ).toBeInTheDocument()
      );

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/proposals/${proposalId}/revisions`
      );
    });

    it("toggles history panel visibility", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();
        fireEvent.click(
          screen.getByRole("button", { name: /hide history/i })
        );

      await waitFor(() =>
        expect(
          screen.queryByText(/Revision 2 of 2/i, { selector: "span" })
        ).not.toBeInTheDocument()
      );

        fireEvent.click(
          screen.getByRole("button", { name: /show history/i })
        );

      await waitFor(() =>
        expect(screen.getByText(/Revision 2 of 2/i)).toBeInTheDocument()
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("screening button", () => {
    it("disables screening button when wallet not connected", async () => {
      mockSignedAccountId = null;
      mockWalletSigner = null;
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /connect wallet to screen/i,
      });
      expect(button).toBeDisabled();
    });

    it("enables screening button when wallet connected and revision unscreened", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /screen this revision/i,
      });
      expect(button).toBeEnabled();
    });

    it("shows appropriate button text based on screening state", async () => {
      let resolveSave!: (value: {
        ok: boolean;
        status: number;
        json: () => Promise<typeof defaultSaveResponseBody>;
      }) => void;

      const savePromise = new Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<typeof defaultSaveResponseBody>;
      }>((resolve) => {
        resolveSave = resolve;
      });

      const fetchMock = vi.fn((input: RequestInfo) => {
        const url =
          typeof input === "string"
            ? input
            : typeof input === "object"
            ? input.url
            : "";

        if (url.includes(`/api/proposals/${proposalId}/revisions`)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => baseRevisionResponse,
          });
        }

        if (url.includes("/api/getAnalysis")) {
          return Promise.resolve({
            ok: false,
            status: 200,
            json: async () => ({}),
          });
        }

        if (url.includes(`/api/saveAnalysis/${proposalId}`)) {
          return savePromise;
        }

        return Promise.reject(new Error(`Unexpected fetch to ${url}`));
      });

      vi.stubGlobal("fetch", fetchMock);
      renderComponent();
      await openHistoryWithRevisions();

      const screenButton = await screen.findByRole("button", {
        name: /screen this revision/i,
      });

      fireEvent.click(screenButton);

      await waitFor(() =>
        expect(screen.getByText(/Screening\.\.\./i)).toBeInTheDocument()
      );

      resolveSave({
        ok: true,
        status: 200,
        json: async () => defaultSaveResponseBody,
      });

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/saveAnalysis/${proposalId}`,
          expect.any(Object)
        )
      );
    });
  });

  describe("handleScreenRevision", () => {
    it("calls sign with correct message format", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /screen this revision/i,
      });
      fireEvent.click(button);

      await waitFor(() =>
        expect(signMock).toHaveBeenCalledWith(
          `Screen proposal ${proposalId}`,
          expect.any(Object)
        )
      );
    });

    it("calls sign with walletSigner and correct recipient", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /screen this revision/i,
      });
      fireEvent.click(button);

      await waitFor(() =>
        expect(signMock).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            signer: mockWalletSigner,
            recipient: "social.near",
          })
        )
      );
    });

    it("POSTs to screening endpoint with auth token on successful sign", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /screen this revision/i,
      });
      fireEvent.click(button);

      await waitFor(() => {
        const saveCall = fetchMock.mock.calls.find(([url]) =>
          typeof url === "string"
            ? url.includes(`/api/saveAnalysis/${proposalId}`)
            : false
        );
        expect(saveCall).toBeDefined();
        const [, options] = saveCall!;
        expect(options).toBeDefined();
        const requestInit = options as RequestInit;
        expect(requestInit.method).toBe("POST");
        expect(requestInit.headers).toMatchObject({
          Authorization: "Bearer auth-token",
          "Content-Type": "application/json",
        });
      });
    });

    it("updates UI on successful screening", async () => {
      const fetchMock = stubFetch();
      renderComponent();

      await openHistoryWithRevisions();

      const button = await screen.findByRole("button", {
        name: /screen this revision/i,
      });
      fireEvent.click(button);

      await screen.findByText(/Evaluation/i);
    });

    it("handles sign rejection/cancellation gracefully", async () => {
      const fetchMock = stubFetch();
      signMock.mockRejectedValue(new Error("Signing cancelled"));
      renderComponent();

      await openHistoryWithRevisions();

      fireEvent.click(
        await screen.findByRole("button", { name: /screen this revision/i })
      );

      await screen.findByText(/Signing cancelled/i);
    });

    it("handles network errors during POST", async () => {
      const fetchMock = stubFetch({
        saveAnalysisReject: new Error("Network issue"),
      });
      renderComponent();

      await openHistoryWithRevisions();

      fireEvent.click(
        await screen.findByRole("button", { name: /screen this revision/i })
      );

      await screen.findByText(/Network issue/i);
    });

    const apiErrors = [
      {
        status: 401,
        body: { error: "Unauthorized" },
        expectedText: /Unauthorized/i,
      },
      {
        status: 409,
        body: {},
        expectedText: /already been evaluated/i,
      },
      {
        status: 500,
        body: { error: "Server failure" },
        expectedText: /Server failure/i,
      },
    ];

    it.each(apiErrors)(
      "handles API error responses ($status)",
      async ({ status, body, expectedText }) => {
        const fetchMock = stubFetch({
          saveAnalysisResponse: {
            ok: status === 409 ? false : false,
            status,
            body,
          },
        });
        renderComponent();

        await openHistoryWithRevisions();

        fireEvent.click(
          await screen.findByRole("button", {
            name: /screen this revision/i,
          })
        );

        await screen.findByText(expectedText);
      }
    );
  });
});
