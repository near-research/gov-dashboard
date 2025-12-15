import { useCallback, useState } from "react";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type {
  DiscussionSummaryResponse,
  ProposalRevisionSummaryResponse,
  ReplySummaryResponse,
  TextSummaryResponse,
} from "@/components/proposal/types/summaries";
import { buildRateLimitMessage } from "@/utils/rateLimitHelpers";

interface UseProposalSummariesArgs {
  proposalId?: string;
  selectedVersion: number;
  track: GovernanceTrackFn;
}

export function useProposalSummaries({
  proposalId,
  selectedVersion,
  track,
}: UseProposalSummariesArgs) {
  const [proposalSummary, setProposalSummary] =
    useState<TextSummaryResponse | null>(null);
  const [proposalSummaryLoading, setProposalSummaryLoading] = useState(false);
  const [proposalSummaryError, setProposalSummaryError] = useState("");
  const [revisionSummary, setRevisionSummary] =
    useState<ProposalRevisionSummaryResponse | null>(null);
  const [revisionSummaryLoading, setRevisionSummaryLoading] = useState(false);
  const [revisionSummaryError, setRevisionSummaryError] = useState("");
  const [replySummaries, setReplySummaries] = useState<
    Record<number, ReplySummaryResponse>
  >({});
  const [replySummaryLoading, setReplySummaryLoading] = useState<
    Record<number, boolean>
  >({});
  const [replySummaryErrors, setReplySummaryErrors] = useState<
    Record<number, string>
  >({});
  const [discussionSummary, setDiscussionSummary] =
    useState<DiscussionSummaryResponse | null>(null);
  const [discussionSummaryVisible, setDiscussionSummaryVisible] =
    useState(false);
  const [discussionSummaryLoading, setDiscussionSummaryLoading] =
    useState(false);
  const [discussionSummaryError, setDiscussionSummaryError] = useState("");

  const parseErrorResponse = useCallback(
    async (response: Response, defaultMessage: string) => {
      try {
        const data = await response.json();
        if (response.status === 429) {
          return buildRateLimitMessage(response, data?.retryAfter ?? null);
        }
        return data?.message || data?.error || defaultMessage;
      } catch {
        if (response.status === 429) {
          return buildRateLimitMessage(response);
        }
        return defaultMessage;
      }
    },
    []
  );

  const fetchProposalSummary = useCallback(async () => {
    if (!proposalId) return;
    const topicId = String(proposalId);
    setProposalSummaryLoading(true);
    setProposalSummaryError("");

    track("proposal_summary_requested", {
      props: { topic_id: topicId },
    });

    try {
      const response = await fetch(`/api/proposals/${proposalId}/summarize`, {
        method: "POST",
      });
      if (response.ok) {
        const data: TextSummaryResponse = await response.json();
        setProposalSummary(data);
        setProposalSummaryError("");

        track("proposal_summary_succeeded", {
          props: { topic_id: topicId },
        });
      } else {
        const message = await parseErrorResponse(
          response,
          "Failed to fetch proposal summary"
        );
        setProposalSummaryError(message);

        track("proposal_summary_failed", {
          props: {
            topic_id: topicId,
            message: message.slice(0, 120),
          },
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch proposal summary";
      setProposalSummaryError(message);

      track("proposal_summary_failed", {
        props: {
          topic_id: topicId,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setProposalSummaryLoading(false);
    }
  }, [parseErrorResponse, proposalId, track]);

  const fetchRevisionSummary = useCallback(async () => {
    if (!proposalId) return;
    const topicId = String(proposalId);
    setRevisionSummaryLoading(true);
    setRevisionSummaryError("");

    track("proposal_revision_summary_requested", {
      props: {
        topic_id: topicId,
        revision: selectedVersion,
      },
    });

    try {
      const response = await fetch(
        `/api/proposals/${proposalId}/revisions/summarize`,
        {
          method: "POST",
        }
      );
      if (response.ok) {
        const data: ProposalRevisionSummaryResponse = await response.json();
        setRevisionSummary(data);
        setRevisionSummaryError("");

        track("proposal_revision_summary_succeeded", {
          props: {
            topic_id: topicId,
            revision: selectedVersion,
          },
        });
      } else {
        const message = await parseErrorResponse(
          response,
          "Failed to fetch revision summary"
        );
        setRevisionSummaryError(message);

        track("proposal_revision_summary_failed", {
          props: {
            topic_id: topicId,
            revision: selectedVersion,
            message: message.slice(0, 120),
          },
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch revision summary";
      setRevisionSummaryError(message);

      track("proposal_revision_summary_failed", {
        props: {
          topic_id: topicId,
          revision: selectedVersion,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setRevisionSummaryLoading(false);
    }
  }, [parseErrorResponse, proposalId, selectedVersion, track]);

  const fetchReplySummary = useCallback(
    async (replyId: number) => {
      if (!proposalId) return;
      const topicId = String(proposalId);

      setReplySummaryLoading((prev) => ({ ...prev, [replyId]: true }));
      setReplySummaryErrors((prev) => ({ ...prev, [replyId]: "" }));

      track("proposal_reply_summary_requested", {
        props: {
          topic_id: topicId,
          reply_id: replyId,
        },
      });

      try {
        const response = await fetch(
          `/api/discourse/replies/${replyId}/summarize`,
          {
            method: "POST",
          }
        );
        if (response.ok) {
          const data: ReplySummaryResponse = await response.json();
          setReplySummaries((prev) => ({ ...prev, [replyId]: data }));
          setReplySummaryErrors((prev) => ({ ...prev, [replyId]: "" }));

          track("proposal_reply_summary_succeeded", {
            props: {
              topic_id: topicId,
              reply_id: replyId,
            },
          });
        } else {
          const message = await parseErrorResponse(
            response,
            "Failed to fetch reply summary"
          );
          setReplySummaryErrors((prev) => ({ ...prev, [replyId]: message }));

          track("proposal_reply_summary_failed", {
            props: {
              topic_id: topicId,
              reply_id: replyId,
              message: message.slice(0, 120),
            },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch reply summary";

        setReplySummaryErrors((prev) => ({
          ...prev,
          [replyId]: message,
        }));

        track("proposal_reply_summary_failed", {
          props: {
            topic_id: topicId,
            reply_id: replyId,
            message: message.slice(0, 120),
          },
        });
      } finally {
        setReplySummaryLoading((prev) => ({ ...prev, [replyId]: false }));
      }
    },
    [parseErrorResponse, proposalId, track]
  );

  const handleDiscussionSummary = useCallback(async () => {
    if (!proposalId) return;
    const topicId = String(proposalId);

    if (discussionSummary) {
      const nextVisible = !discussionSummaryVisible;
      setDiscussionSummaryVisible(nextVisible);

      track("proposal_discussion_summary_toggled", {
        props: {
          topic_id: topicId,
          visible: nextVisible,
        },
      });
      return;
    }

    setDiscussionSummaryLoading(true);
    setDiscussionSummaryError("");

    track("proposal_discussion_summary_requested", {
      props: { topic_id: topicId },
    });

    try {
      const response = await fetch(
        `/api/discourse/topics/${proposalId}/summarize`,
        {
          method: "POST",
        }
      );
      if (!response.ok) {
        const message = await parseErrorResponse(
          response,
          "Failed to generate summary"
        );
        throw new Error(message);
      }
      const data: DiscussionSummaryResponse = await response.json();
      setDiscussionSummary(data);
      setDiscussionSummaryVisible(true);

      track("proposal_discussion_summary_succeeded", {
        props: { topic_id: topicId },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate summary";
      setDiscussionSummaryError(message);

      track("proposal_discussion_summary_failed", {
        props: {
          topic_id: topicId,
          message: message.slice(0, 120),
        },
      });
    } finally {
      setDiscussionSummaryLoading(false);
    }
  }, [
    discussionSummary,
    discussionSummaryVisible,
    parseErrorResponse,
    proposalId,
    track,
  ]);

  const hideReplySummary = useCallback((replyId: number) => {
    setReplySummaries((prev) => {
      const next = { ...prev };
      delete next[replyId];
      return next;
    });
    setReplySummaryErrors((prev) => {
      const next = { ...prev };
      delete next[replyId];
      return next;
    });
  }, []);

  return {
    proposalSummary,
    proposalSummaryLoading,
    proposalSummaryError,
    fetchProposalSummary,
    setProposalSummary,
    revisionSummary,
    revisionSummaryLoading,
    revisionSummaryError,
    fetchRevisionSummary,
    setRevisionSummary,
    replySummaries,
    replySummaryLoading,
    replySummaryErrors,
    fetchReplySummary,
    hideReplySummary,
    discussionSummary,
    discussionSummaryVisible,
    discussionSummaryLoading,
    discussionSummaryError,
    handleDiscussionSummary,
  };
}
