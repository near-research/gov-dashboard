import "../../../vi-compat";
import React, { type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { DiscussionSection } from "@/components/proposal/DiscussionSection";
import { siwnRecipient } from "@/config/siwn";

const { signMock } = vi.hoisted(() => ({
  signMock: vi.fn(),
}));

vi.mock("near-sign-verify", () => ({
  sign: signMock,
}));

const { getLinkageMock, createPostMock } = vi.hoisted(() => ({
  getLinkageMock: vi.fn(),
  createPostMock: vi.fn(),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    discourse: {
      getLinkage: getLinkageMock,
      createPost: createPostMock,
    },
  },
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  useGovernanceAnalytics: () => trackMock,
}));

type MockWalletSigner = {
  signMessage: ReturnType<typeof vi.fn>;
};

const createMockWalletSigner = (): MockWalletSigner => ({
  signMessage: vi.fn(),
});

let mockSignedAccountId: string | null = "alice.testnet";
let mockWalletSigner: MockWalletSigner | null = createMockWalletSigner();
vi.mock("@/hooks/useNear", () => ({
  useNear: () => ({
    signedAccountId: mockSignedAccountId,
    walletSigner: mockWalletSigner,
  }),
}));

vi.mock("@/components/proposal/ReplyCard", () => ({
  ReplyCard: () => <div data-testid="reply-card" />,
}));

const replies = [
  {
    id: 1,
    username: "bob",
    created_at: new Date().toISOString(),
    cooked: "<p>Reply</p>",
    post_number: 1,
    avatar_template: "",
    like_count: 0,
    reply_to_post_number: 0,
  },
];

const replyTextareaPlaceholder =
  /Write a reply to the discussion\.\.\./i;

type DiscussionSectionProps = ComponentProps<typeof DiscussionSection>;

const defaultProps: DiscussionSectionProps = {
  discourseBaseUrl: "gov.near",
  replies,
  discussionSummary: null,
  discussionSummaryVisible: false,
  discussionSummaryLoading: false,
  discussionSummaryError: "",
  showReplies: false,
  onToggleReplies: vi.fn(),
  onHandleDiscussionSummary: vi.fn(),
  replySummaries: {},
  replySummaryLoading: {},
  replySummaryErrors: {},
  onFetchReplySummary: vi.fn(),
  onHideReplySummary: vi.fn(),
  topicId: 123,
  onReplyPosted: vi.fn(),
  topicAuthor: "alice",
};

const renderDiscussionSection = (
  override: Partial<DiscussionSectionProps> = {}
) => {
  const props = { ...defaultProps, ...override };
  render(<DiscussionSection {...props} />);
  return { props };
};

const renderDiscussionSectionWithReplies = (
  override: Partial<DiscussionSectionProps> = {}
) => renderDiscussionSection({ showReplies: true, ...override });

const getPrimaryReplyTextarea = () =>
  screen.getAllByPlaceholderText(replyTextareaPlaceholder)[0];

const getPrimaryPostReplyButton = () =>
  screen.getAllByRole("button", { name: /Post reply/i })[0];

const findPrimaryPostReplyButton = async () =>
  (await screen.findAllByRole("button", { name: /Post reply/i }))[0];

const setNearState = (
  account: string | null,
  signer: MockWalletSigner | null = createMockWalletSigner()
) => {
  mockSignedAccountId = account;
  mockWalletSigner = signer;
};

beforeEach(() => {
  vi.resetAllMocks();
  setNearState("alice.testnet", { signMessage: vi.fn() });
  getLinkageMock.mockResolvedValue(null);
  createPostMock.mockResolvedValue({ postUrl: "https://discourse/topic/1" });
  signMock.mockResolvedValue("auth-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiscussionSection", () => {
  describe("rendering", () => {
    it("renders reply form when authenticated and linked", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      await waitFor(() =>
        expect(
          screen.getAllByText(/You're linked and ready to reply\./i)[0]
        ).toBeInTheDocument()
      );
      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Ready to reply" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
    });

    it("shows connect wallet prompt when not authenticated", async () => {
      setNearState(null, null);
      renderDiscussionSectionWithReplies();

      await waitFor(() =>
        expect(
          screen.getAllByText(/Connect your NEAR wallet to reply\./i)[0]
        ).toBeInTheDocument()
      );
    });

    it("shows link Discourse prompt when authenticated but not linked", async () => {
      getLinkageMock.mockResolvedValue(null);
      renderDiscussionSectionWithReplies();

      await waitFor(() =>
        expect(
          screen.getAllByText(/Link your Discourse account on the/i)[0]
        ).toBeInTheDocument()
      );
    });

    it("still renders the reply form when there are no replies yet", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies({ replies: [] });

      await waitFor(() =>
        expect(screen.getByText(/No replies yet/i)).toBeInTheDocument()
      );
      expect(getPrimaryReplyTextarea()).toBeInTheDocument();
    });
  });

  describe("validation", () => {
    it("disables submit button when reply is empty", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      await waitFor(() =>
        expect(getPrimaryPostReplyButton()).toBeDisabled()
      );
    });

    it("prevents submitting empty replies", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      const button = getPrimaryPostReplyButton();
      expect(button).toBeDisabled();

      fireEvent.click(button);

      await waitFor(() =>
        expect(
          screen.queryByText(/Add a reply before submitting\./i)
        ).not.toBeInTheDocument()
      );
    });

    it("enables submit button with valid reply text", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Valid reply" } });

      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
    });
  });

  describe("reply submission", () => {
    it("calls sign with message format 'Reply to proposal {topicId}'", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Hello" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      await waitFor(() =>
        expect(signMock).toHaveBeenCalledWith(
          SIGNING_MESSAGES.replyToProposal(defaultProps.topicId),
          expect.any(Object)
        )
      );
    });

    it("calls sign with walletSigner and correct recipient", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Hello" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      await waitFor(() =>
          expect(signMock).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              signer: mockWalletSigner,
              recipient: siwnRecipient,
            })
          )
      );
    });

    it("calls client.discourse.createPost with auth token and reply content", async () => {
      getLinkageMock.mockResolvedValue({
        discourseUsername: "alice",
      });
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "  Trimmed reply  " } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      await waitFor(() =>
        expect(createPostMock).toHaveBeenCalledWith({
          authToken: "auth-token",
          username: "alice",
          nearAccount: mockSignedAccountId,
          raw: "Trimmed reply",
          topicId: defaultProps.topicId,
          replyToPostNumber: 1,
        })
      );
    });

    it("clears form and shows success toast on successful submission", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Great insights" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith("Reply posted")
      );
      expect(textarea).toHaveValue("");
      expect(trackMock).toHaveBeenCalledWith("discussion_reply_started", {
        props: {
          topic_id: defaultProps.topicId,
          reply_to_post_number: 1,
        },
      });
      expect(trackMock).toHaveBeenCalledWith("discussion_reply_succeeded", {
        props: {
          topic_id: defaultProps.topicId,
          reply_to_post_number: 1,
        },
      });
      expect(defaultProps.onReplyPosted).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("handles sign rejection gracefully", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      signMock.mockRejectedValue(new Error("Signing rejected"));
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Error reply" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      const [signRejected] = await screen.findAllByText(/Signing rejected/i);
      expect(signRejected).toBeInTheDocument();
      await waitFor(() =>
        expect(trackMock).toHaveBeenCalledWith("discussion_reply_failed", {
          props: expect.objectContaining({ topic_id: defaultProps.topicId }),
        })
      );
      await waitFor(() =>
        expect(getPrimaryPostReplyButton()).toBeEnabled()
      );
    });

    it("shows error message on createPost failure", async () => {
      getLinkageMock.mockResolvedValue({ discourseUsername: "alice" });
      createPostMock.mockRejectedValue(new Error("Create failed"));
      renderDiscussionSectionWithReplies();

      const textarea = getPrimaryReplyTextarea();
      fireEvent.change(textarea, { target: { value: "Another reply" } });
      const button = await findPrimaryPostReplyButton();
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      const [createFailed] = await screen.findAllByText(/Create failed/i);
      expect(createFailed).toBeInTheDocument();
      await waitFor(() =>
        expect(getPrimaryPostReplyButton()).toBeEnabled()
      );
    });
  });
});
