import { useCallback, useEffect, useRef, useState } from "react";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import type {
  ProposalDetailResponse,
  ProposalRevision,
} from "@/components/proposal/types/proposals";
import type { DiscourseRevisionResponse } from "@/types/discourse";
import { reconstructRevisionContent } from "@/utils/ui/revision-content";
import { logger } from "@/lib/logger";

export interface ScreeningData {
  evaluation: Evaluation;
  title: string;
  nearAccount: string;
  timestamp: string;
  revisionNumber: number;
  qualityScore: number;
  attentionScore: number;
  model?: string;
  verification?: VerificationMetadata | null;
  verificationId?: string | null;
}

interface UseProposalDetailArgs {
  proposalId?: string;
  track: GovernanceTrackFn;
}

function useProposalData(proposalId: string | undefined, track: GovernanceTrackFn) {
  const [proposal, setProposal] = useState<ProposalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screening, setScreening] = useState<ScreeningData | null>(null);
  const [screeningChecked, setScreeningChecked] = useState(false);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [currentRevision, setCurrentRevision] = useState<number>(1);
  const [revisions, setRevisions] = useState<ProposalRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const latestScreeningRequest = useRef<{ topicId: string; revision: number }>({
    topicId: "",
    revision: 0,
  });
  const screeningAbortController = useRef<AbortController | null>(null);
  const proposalAbortController = useRef<AbortController | null>(null);
  const trackRef = useRef<GovernanceTrackFn>(track);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const fetchScreening = useCallback(
    async (topicId: string, revisionNumber: number) => {
      screeningAbortController.current?.abort();
      const controller = new AbortController();
      screeningAbortController.current = controller;
      const requestKey = { topicId, revision: revisionNumber };
      latestScreeningRequest.current = requestKey;
      setScreeningChecked(false);
      setScreeningError(null);
      const isLatestRequest = () =>
        latestScreeningRequest.current.topicId === requestKey.topicId &&
        latestScreeningRequest.current.revision === requestKey.revision;

      try {
        const response = await fetch(
          `/api/getAnalysis/${topicId}?revisionNumber=${revisionNumber}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (
          latestScreeningRequest.current.topicId !== topicId ||
          latestScreeningRequest.current.revision !== revisionNumber
        ) {
          return;
        }
        if (response.status === 404) {
          setScreening(null);
          if (isLatestRequest()) {
            setScreeningChecked(true);
          }
          return;
        }

        if (!response.ok) {
          setScreening(null);
          setScreeningError(`Failed to fetch screening (${response.status})`);
          return;
        }

        const data = await response.json();
        if (controller.signal.aborted) return;
        const normalized = {
          ...data,
          model: data.model ?? data.evaluation?.model ?? undefined,
        };
        if (isLatestRequest()) {
          setScreening(normalized);
          setScreeningChecked(true);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        logger.warn("[screening] fetch failed", { topicId, revisionNumber, err });
        trackRef.current("proposal_screening_failed", {
          props: {
            topic_id: topicId,
            revision: revisionNumber,
            message: err instanceof Error ? err.message : "Failed to fetch screening",
          },
        });
        if (isLatestRequest()) {
          const message =
            err instanceof Error ? err.message : "Failed to fetch screening";
          setScreeningError(message);
          setScreeningChecked(false);
        }
      }
    },
    []
  );

  const fetchProposal = useCallback(
    async (id: string) => {
      proposalAbortController.current?.abort();
      const controller = new AbortController();
      proposalAbortController.current = controller;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/proposals/${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error("Failed to fetch proposal");
        }
        const data: ProposalDetailResponse = await response.json();
        if (controller.signal.aborted) return;
        setProposal(data);

        const initialRevision = data.version || 1;
        setCurrentRevision(initialRevision);
        fetchScreening(id, initialRevision);

        trackRef.current("proposal_viewed", {
          props: {
            topic_id: id,
            category: data.metadata?.category ?? null,
            reply_count: data.reply_count,
          },
        });
      } catch (err: unknown) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to fetch proposal";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [fetchScreening]
  );

  const fetchRevisions = useCallback(
    async (id: string) => {
      setRevisionsLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/proposals/${id}/revisions`);
        if (!res.ok) throw new Error("Failed to fetch revisions");
        const data: DiscourseRevisionResponse = await res.json();
        const latestRevision = data.current_version || 1;
        setCurrentRevision(latestRevision);

        if (Array.isArray(data.revisions) && data.revisions.length > 0) {
          setRevisions(data.revisions);
        } else {
          setRevisions([]);
        }
        await fetchScreening(id, latestRevision);
        return latestRevision;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch revisions";
        setError(message);
        return null;
      } finally {
        setRevisionsLoading(false);
      }
    },
    [fetchScreening]
  );

  useEffect(() => {
    if (!proposalId) return;
    proposalAbortController.current?.abort();
    screeningAbortController.current?.abort();
    setProposal(null);
    setScreening(null);
    setScreeningChecked(false);
    setRevisions([]);
    setCurrentRevision(1);
    setError("");
    setLoading(true);
  }, [proposalId]);

  useEffect(
    () => () => {
      proposalAbortController.current?.abort();
      screeningAbortController.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (proposalId) {
      fetchProposal(proposalId);
    }
  }, [fetchProposal, proposalId]);

  return {
    proposal,
    loading,
    error,
    screening,
    screeningChecked,
    screeningError,
    currentRevision,
    revisions,
    revisionsLoading,
    fetchProposal,
    fetchRevisions,
    fetchScreening,
    setScreeningChecked,
  };
}

export const buildRevisionView = (
  revisions: ProposalRevision[],
  baseContent: string,
  baseTitle: string,
  version: number
): { content: string; diffHtml: string } => {
  const revision = revisions.find((item) => item.version === version);
  let content = baseContent;
  let diffHtml = "";

  if (version > 1 && revisions.length > 0) {
    try {
      const { content: reconstructedContent, success, errors } = reconstructRevisionContent(
        baseContent,
        baseTitle,
        revisions,
        version
      );
      if (success) {
        content = reconstructedContent;
      } else {
        logger.warn("[revisions] reconstruction returned errors", {
          version,
          errors,
          revisionsCount: revisions.length,
        });
        content = baseContent;
      }
    } catch (err) {
      logger.warn("[revisions] failed to reconstruct content", {
        version,
        revisionsCount: revisions.length,
        error: err instanceof Error ? err.message : err,
      });
      content = baseContent;
    }
  }

  if (revision?.body_changes?.inline) {
    diffHtml = revision.body_changes.inline;
  }

  return { content, diffHtml };
};

export function useProposalDetail({
  proposalId,
  track,
}: UseProposalDetailArgs) {
  const [showRevisions, setShowRevisions] = useState(false);
  const [showDiffHighlights, setShowDiffHighlights] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [versionContent, setVersionContent] = useState<string>("");
  const [versionDiffHtml, setVersionDiffHtml] = useState<string>("");

  const {
    proposal,
    loading,
    error,
    screening,
    screeningChecked,
    currentRevision,
    revisions,
    revisionsLoading,
    fetchRevisions,
    fetchScreening,
    fetchProposal,
    setScreeningChecked,
  } = useProposalData(proposalId, track);

  useEffect(() => {
    if (!proposal) return;
    const initialRevision = proposal.version || 1;
    setSelectedVersion(initialRevision);
    setVersionContent(proposal.contentWithoutFrontmatter);
    setVersionDiffHtml("");
  }, [proposal]);

  useEffect(() => {
    if (!proposal) return;
    const { content, diffHtml } = buildRevisionView(
      revisions,
      proposal.contentWithoutFrontmatter || "",
      proposal.title || "",
      selectedVersion
    );
    setVersionContent(content);
    setVersionDiffHtml(diffHtml);
  }, [proposal, revisions, selectedVersion]);

  const handleVersionChange = useCallback(
    async (version: number) => {
      setScreeningChecked(false);
      setSelectedVersion(version);

      if (proposalId) {
        fetchScreening(proposalId, version);
      }
    },
    [fetchScreening, proposalId, setScreeningChecked]
  );

  const handleToggleRevisions = useCallback(async () => {
    const next = !showRevisions;
    setShowRevisions(next);
    if (next && revisions.length === 0 && proposalId) {
      const latestRevision = await fetchRevisions(proposalId);
      if (latestRevision) {
        setSelectedVersion(latestRevision);
      }
    }
  }, [fetchRevisions, proposalId, revisions.length, showRevisions]);

  return {
    proposal,
    loading,
    error,
    screening,
    screeningChecked,
    currentRevision,
    showRevisions,
    setShowRevisions,
    showDiffHighlights,
    setShowDiffHighlights,
    selectedVersion,
    setSelectedVersion,
    versionContent,
    versionDiffHtml,
    revisions,
    revisionsLoading,
    handleVersionChange,
    handleToggleRevisions,
    fetchProposal,
    fetchRevisions,
    fetchScreening,
  };
}
