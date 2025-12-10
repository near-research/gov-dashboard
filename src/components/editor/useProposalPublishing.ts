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

interface UseProposalPublishingParams {
  client: OrpcClient;
  walletSigner: WalletInterface | null;
  signedAccountId: string | null | undefined;
  isPassing: boolean;
  title: string;
  content: string;
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
}: UseProposalPublishingParams) => {
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);
  const [discourseLinked, setDiscourseLinked] = useState(false);
  const [checkingLinkage, setCheckingLinkage] = useState(false);
  const [linkNonce, setLinkNonce] = useState<string>("");
  const [linkPayload, setLinkPayload] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [discourseUsername, setDiscourseUsername] = useState("");
  const [discourseUserApiKey, setDiscourseUserApiKey] = useState("");

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
        console.error("Failed to check Discourse linkage:", err);
        setDiscourseLinked(false);
      } finally {
        setCheckingLinkage(false);
      }
    };
    void checkLinkage();
  }, [client, signedAccountId]);

  const startDiscourseLink = useCallback(async () => {
    try {
      setPublishError("");
      setLinkError("");
      const data = (await client.discourse.initiateLink({
        clientId: "discourse-plugin",
        applicationName: "NEAR Gov",
      })) as DiscourseAuthUrl;
      if (data?.authUrl) {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
        setLinkNonce(data.nonce);
      }
    } catch (err: unknown) {
      console.error("Discourse auth link error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to start Discourse linking";
      setPublishError(message);
    }
  }, [client]);

  const completeDiscourseLink = useCallback(async () => {
    if (!linkNonce || !linkPayload.trim()) {
      setLinkError("Paste the User API key from Discourse to continue.");
      return;
    }
    if (!signedAccountId || !walletSigner) {
      setLinkError("Connect your NEAR wallet first.");
      return;
    }
    setLinking(true);
    setLinkError("");
    try {
      const { sign } = await import("near-sign-verify");
      const authToken = await sign("Link my NEAR account to Discourse", {
        signer: walletSigner,
        recipient: "social.near",
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
      console.error("Complete link error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to complete Discourse link";
      setLinkError(message);
    } finally {
      setLinking(false);
    }
  }, [client, linkNonce, linkPayload, signedAccountId, walletSigner]);

  const publishToDiscourse = useCallback(async () => {
    if (!isPassing) {
      setPublishError("Screening must pass before publishing.");
      return;
    }
    if (!title.trim() || !content.trim()) {
      setPublishError("Add a title and proposal content first.");
      return;
    }
    if (!signedAccountId || !walletSigner) {
      setPublishError("Connect your NEAR wallet to publish.");
      return;
    }
    if (!discourseLinked) {
      setPublishError("Link your Discourse account before publishing.");
      return;
    }

    setPublishLoading(true);
    setPublishError("");
    setPublishSuccess(null);
    track("draft_publish_clicked");

    const payloadForLog = {
      title: title.trim(),
      nearAccount: signedAccountId,
      category: DISCOURSE_PROPOSALS_CATEGORY_ID,
      hasUsername: Boolean(discourseUsername),
      hasUserApiKey: Boolean(discourseUserApiKey),
    };
    console.debug("[draft] createPost payload", payloadForLog);

    try {
      const { sign } = await import("near-sign-verify");
      const authToken = await sign("Publish proposal draft to Discourse", {
        signer: walletSigner,
        recipient: "social.near",
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
      console.error("[draft] publish failed:", {
        error: err,
        rpcData:
          err && typeof err === "object"
            ? (err as Record<string, unknown>).data
            : undefined,
        rpcName: err instanceof Error ? err.name : undefined,
        payload: payloadForLog,
      });
      const message =
        err instanceof Error ? err.message : "Failed to publish to Discourse";
      setPublishError(message);
      track("draft_publish_failed", {
        props: {
          message: message.slice(0, 120),
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
    startDiscourseLink,
    completeDiscourseLink,
    publishToDiscourse,
  };
};
