import { useCallback, useEffect, useState } from "react";
import type { GovernanceTrackFn } from "@/lib/analytics";
import type { WalletInterface } from "near-sign-verify";
type OrpcClient = typeof import("@/lib/orpc").client;
import type {
  DiscourseAuthUrl,
  DiscourseLinkage,
  DiscoursePostResult,
} from "@/types/discourse-linkage";
import { DISCOURSE_PROPOSALS_CATEGORY_ID } from "@/config/discourse";
import { getDiscourseUserApiKey } from "@/utils/discourse";
import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { assertSigningReady } from "@/utils/wallet/guards";
import {
  createNearOperationError,
  logNearError,
  type NearOperationError,
} from "@/utils/errors/near-errors";
import { logger } from "@/lib/logger";
import { siwnRecipient } from "@/config/siwn";

interface UseProposalPublishingParams {
  client: OrpcClient;
  walletSigner: WalletInterface | null;
  signedAccountId: string | null | undefined;
  isPassing: boolean;
  title: string;
  content: string;
  discourseLinked?: boolean;
  track: GovernanceTrackFn;
}

export const useProposalPublishing = ({
  client,
  walletSigner,
  signedAccountId,
  isPassing,
  title,
  content,
  track,
  discourseLinked: initialDiscourseLinked = false,
}: UseProposalPublishingParams) => {
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<NearOperationError | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [discourseLinked, setDiscourseLinked] =
    useState(initialDiscourseLinked);
  const [checkingLinkage, setCheckingLinkage] = useState(false);
  const [linkNonce, setLinkNonce] = useState<string>("");
  const [linkPayload, setLinkPayload] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<NearOperationError | null>(null);
  const [discourseUsername, setDiscourseUsername] = useState("");
  const [discourseUserApiKey, setDiscourseUserApiKey] = useState("");
  const clearPublishError = useCallback(() => setPublishError(null), []);
  const clearLinkError = useCallback(() => setLinkError(null), []);

  const publishDisabled =
    publishLoading ||
    checkingLinkage ||
    !isPassing ||
    !signedAccountId ||
    !discourseLinked ||
    !walletSigner;

  // Check Discourse linkage when account changes
  useEffect(() => {
    const checkLinkage = async () => {
      if (!signedAccountId) {
        setDiscourseLinked(false);
        setDiscourseUsername("");
        setDiscourseUserApiKey("");
        return;
      }
      setCheckingLinkage(true);
      try {
        const linkage = (await client.discourse.getLinkage({
          nearAccount: signedAccountId,
        })) as DiscourseLinkage | null;
        setDiscourseLinked(Boolean(linkage?.discourseUsername));
        setDiscourseUsername(linkage?.discourseUsername ?? "");
        setDiscourseUserApiKey(
          linkage?.userApiKey ?? getDiscourseUserApiKey() ?? ""
        );
      } catch (err) {
        logger.error("Failed to check Discourse linkage", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
        setDiscourseLinked(false);
      } finally {
        setCheckingLinkage(false);
      }
    };
    void checkLinkage();
  }, [client, signedAccountId]);

  const startDiscourseLink = useCallback(async () => {
    try {
      setPublishError(null);
      setLinkError(null);
      const data = (await client.discourse.initiateLink({
        clientId: "discourse-plugin",
        applicationName: "NEAR Gov",
      })) as DiscourseAuthUrl;
      if (data?.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        setLinkNonce(data.nonce);
      }
    } catch (err: unknown) {
      logger.error("Discourse auth link error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      const nearError = createNearOperationError(err);
      logNearError("useProposalPublishing.startDiscourseLink", nearError);
      setPublishError(nearError);
    }
  }, [client]);

  const completeDiscourseLink = useCallback(async () => {
    if (!linkNonce || !linkPayload.trim()) {
      setLinkError(
        createNearOperationError(
          new Error("Paste the User API key from Discourse to continue.")
        )
      );
      return;
    }
    if (!signedAccountId || !walletSigner) {
      setLinkError(
        createNearOperationError(new Error("Connect your NEAR wallet first."))
      );
      return;
    }
    setLinking(true);
    setLinkError(null);
    try {
      assertSigningReady(walletSigner, signedAccountId);
      const { sign } = await import("near-sign-verify");
      const authToken = await sign(SIGNING_MESSAGES.DISCOURSE_LINK, {
        signer: walletSigner,
        recipient: siwnRecipient,
      });
      await client.discourse.completeLink({
        payload: linkPayload.trim(),
        nonce: linkNonce,
        authToken,
      });
      const linkage = (await client.discourse.getLinkage({
        nearAccount: signedAccountId || "",
      })) as DiscourseLinkage | null;
      setDiscourseLinked(Boolean(linkage?.discourseUsername));
      setDiscourseUsername(linkage?.discourseUsername ?? "");
      setDiscourseUserApiKey(
        linkage?.userApiKey ?? getDiscourseUserApiKey() ?? ""
      );
      setLinkPayload("");
      setLinkNonce("");
    } catch (err: unknown) {
      logger.error("Complete link error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      const nearError = createNearOperationError(err);
      logNearError("useProposalPublishing.completeDiscourseLink", nearError);
      setLinkError(nearError);
    } finally {
      setLinking(false);
    }
  }, [client, linkNonce, linkPayload, signedAccountId, walletSigner]);

  const publishToDiscourse = useCallback(async () => {
    const validationError = (message: string) =>
      createNearOperationError(new Error(message));
    if (!isPassing) {
      setPublishError(validationError("Screening must pass before publishing."));
      return;
    }
    if (!title.trim() || !content.trim()) {
      setPublishError(
        validationError("Add a title and proposal content first.")
      );
      return;
    }
    if (!signedAccountId || !walletSigner) {
      setPublishError(
        validationError("Connect your NEAR wallet to publish.")
      );
      return;
    }
    if (!discourseLinked) {
      setPublishError(
        validationError("Link your Discourse account before publishing.")
      );
      return;
    }

    setPublishLoading(true);
    setPublishError(null);
    setPublishSuccess(null);
    track("draft_publish_clicked");

    const payloadForLog = {
      title: title.trim(),
      nearAccount: signedAccountId,
      category: DISCOURSE_PROPOSALS_CATEGORY_ID,
      hasUsername: Boolean(discourseUsername),
      hasUserApiKey: Boolean(discourseUserApiKey),
    };
    logger.debug("[draft] createPost payload", payloadForLog);

    try {
      assertSigningReady(walletSigner, signedAccountId);
      const { sign } = await import("near-sign-verify");
      const authToken = await sign(SIGNING_MESSAGES.DISCOURSE_PUBLISH, {
        signer: walletSigner,
        recipient: siwnRecipient,
      });

      const userApiKey =
        discourseUserApiKey || getDiscourseUserApiKey() || undefined;
      const result = (await client.discourse.createPost({
        authToken,
        username: discourseUsername,
        userApiKey,
        nearAccount: signedAccountId ?? undefined,
        title: title.trim(),
        raw: content.trim(),
        category: DISCOURSE_PROPOSALS_CATEGORY_ID,
      })) as DiscoursePostResult;

      setPublishSuccess(result.postUrl || "Published to Discourse");
      track("draft_publish_succeeded", {
        props: {
          topic_id: result.topicId ?? null,
        },
      });
    } catch (err: unknown) {
      const nearError = createNearOperationError(err);
      logNearError("useProposalPublishing.publishToDiscourse", nearError);
      logger.error("[draft] publish failed", {
        error: nearError.originalError,
        rpcData:
          err && typeof err === "object"
            ? (err as Record<string, unknown>).data
            : undefined,
        rpcName: err instanceof Error ? err.name : undefined,
        payload: payloadForLog,
      });
      setPublishError(nearError);
      track("draft_publish_failed", {
        props: {
          message: nearError.message.slice(0, 120),
        },
      });
    } finally {
      setPublishLoading(false);
    }
  }, [
    isPassing,
    title,
    content,
    signedAccountId,
    discourseLinked,
    discourseUserApiKey,
    discourseUsername,
    client,
    track,
    walletSigner,
  ]);

  return {
    publishLoading,
    publishError,
    publishSuccess,
    discourseLinked,
    checkingLinkage,
    linkNonce,
    linkPayload,
    linking,
    linkError,
    publishDisabled,
    setLinkPayload,
    setLinkError,
    clearPublishError,
    clearLinkError,
    startDiscourseLink,
    completeDiscourseLink,
    publishToDiscourse,
    discourseUsername,
    discourseUserApiKey,
  };
};
