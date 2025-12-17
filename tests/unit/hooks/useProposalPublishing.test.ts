import "../../vi-compat";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { getDiscourseUserApiKey } from "@/utils/discourse";
import { siwnRecipient } from "@/config/siwn";
import { useProposalPublishing } from "@/components/editor/useProposalPublishing";

type OrpcClient = typeof import("@/lib/orpc").client;

const getLinkageMock = vi.fn();
const initiateLinkMock = vi.fn();
const completeLinkMock = vi.fn();
const createPostMock = vi.fn();

const client: OrpcClient = {
  healthCheck: vi.fn(async () => "OK"),
  discourse: {
    getLinkage: getLinkageMock,
    initiateLink: initiateLinkMock,
    completeLink: completeLinkMock,
    createPost: createPostMock,
  },
} as unknown as OrpcClient;

const { signMock } = vi.hoisted(() => ({
  signMock: vi.fn(),
}));
vi.mock("near-sign-verify", () => ({
  sign: signMock,
}));

const trackMock = vi.fn();
const walletSigner = { signMessage: vi.fn() };

vi.mock("@/utils/discourse", () => ({
  getDiscourseUserApiKey: vi.fn(() => "stub-user-api"),
}));

const defaultProps = {
  client,
  walletSigner,
  signedAccountId: "alice.testnet",
  isPassing: true,
  title: "Proposal Title",
  content: "Proposal content",
  track: trackMock,
};

const renderPublishingHook = (props = {}) =>
  renderHook((hookProps) => useProposalPublishing(hookProps), {
    initialProps: { ...defaultProps, ...props },
  });

const stubLinkage = (value: any) => {
  getLinkageMock.mockResolvedValue(value);
};

beforeEach(() => {
  vi.resetAllMocks();
  stubLinkage(null);
  initiateLinkMock.mockResolvedValue({ authUrl: "https://discourse", nonce: "nonce-123" });
  completeLinkMock.mockResolvedValue(undefined);
  createPostMock.mockResolvedValue({ postUrl: "https://discourse/topic/1", topicId: 1 });
  signMock.mockResolvedValue("auth-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProposalPublishing", () => {
  describe("linkage check", () => {
    it("checks Discourse linkage on mount when signedAccountId present", async () => {
      stubLinkage({ discourseUsername: "alice" });
      const { result } = renderPublishingHook();

      await waitFor(() => {
        expect(result.current.discourseLinked).toBe(true);
      });

      expect(getLinkageMock).toHaveBeenCalledWith({ nearAccount: "alice.testnet" });
    });

    it("skips linkage check when not authenticated", async () => {
      const { result } = renderPublishingHook({ signedAccountId: null });

      await waitFor(() => {
        expect(result.current.discourseLinked).toBe(false);
        expect(getLinkageMock).not.toHaveBeenCalled();
      });
    });

    it("updates isDiscourseLinked state based on getLinkage response", async () => {
      stubLinkage({ discourseUsername: "bob" });
      const { result } = renderPublishingHook();

      await waitFor(() => {
        expect(result.current.discourseLinked).toBe(true);
        expect(result.current.discourseUsername).toBe("bob");
      });
    });
  });

  describe("startDiscourseLink", () => {
    it("calls client.discourse.initiateLink with correct params", async () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());

      expect(initiateLinkMock).toHaveBeenCalledWith({
        clientId: "discourse-plugin",
        applicationName: "NEAR Gov",
      });
      expect(openSpy).toHaveBeenCalledWith(
        "https://discourse",
        "_blank",
        "noopener,noreferrer"
      );
      expect(result.current.linkNonce).toBe("nonce-123");
      openSpy.mockRestore();
    });

    it("handles initiateLink errors", async () => {
      initiateLinkMock.mockRejectedValue(new Error("failed to initiate"));
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());

      await waitFor(() => {
        expect(result.current.publishError?.code).toBe("UNKNOWN");
      });
    });
  });

  describe("completeDiscourseLink", () => {
    it("calls sign with message and walletSigner", async () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());
      act(() => {
        result.current.setLinkPayload("  api-key  ");
      });

      await act(async () => result.current.completeDiscourseLink());

      expect(signMock).toHaveBeenCalledWith(SIGNING_MESSAGES.DISCOURSE_LINK, {
        signer: walletSigner,
        recipient: siwnRecipient,
      });
      openSpy.mockRestore();
    });

    it("calls completeLink with auth token", async () => {
      stubLinkage({ discourseUsername: "alice" });
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());
      act(() => result.current.setLinkPayload("key"));

      await act(async () => result.current.completeDiscourseLink());

      expect(completeLinkMock).toHaveBeenCalledWith({
        payload: "key",
        nonce: "nonce-123",
        authToken: "auth-token",
      });
      await waitFor(() =>
      expect(result.current.discourseLinked).toBe(true)
      );
      expect(result.current.linkPayload).toBe("");
      expect(result.current.linkNonce).toBe("");
    });

    it("handles sign rejection", async () => {
      signMock.mockRejectedValue(new Error("User rejected"));
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());
      act(() => result.current.setLinkPayload("key"));

      await act(async () => result.current.completeDiscourseLink());

      await waitFor(() =>
        expect(result.current.linkError?.code).toBe("USER_REJECTED")
      );
    });

    it("handles completeLink API errors", async () => {
      completeLinkMock.mockRejectedValue(new Error("API error"));
      const { result } = renderPublishingHook();

      await act(async () => result.current.startDiscourseLink());
      act(() => result.current.setLinkPayload("key"));

      await act(async () => result.current.completeDiscourseLink());

      await waitFor(() =>
        expect(result.current.linkError?.code).toBe("UNKNOWN")
      );
    });
  });

  describe("publishToDiscourse", () => {
    it("calls sign and createPost with signed auth token", async () => {
      stubLinkage({ discourseUsername: "bob" });
      const { result } = renderPublishingHook();

      await waitFor(() => expect(result.current.discourseLinked).toBe(true));
      await act(async () => result.current.publishToDiscourse());

      expect(signMock).toHaveBeenCalledWith(SIGNING_MESSAGES.DISCOURSE_PUBLISH, {
        signer: walletSigner,
        recipient: siwnRecipient,
      });
      expect(createPostMock).toHaveBeenCalledWith({
        authToken: "auth-token",
        username: "bob",
        nearAccount: "alice.testnet",
        title: "Proposal Title",
        raw: "Proposal content",
        category: expect.any(Number),
      });
      await waitFor(() =>
        expect(result.current.publishSuccess).toBe("https://discourse/topic/1")
      );
      expect(trackMock).toHaveBeenCalledWith("draft_publish_clicked");
      expect(trackMock).toHaveBeenCalledWith("draft_publish_succeeded", expect.any(Object));
    });

    it("handles sign rejection", async () => {
      signMock.mockRejectedValue(new Error("Signing failed"));
      const { result } = renderPublishingHook({
        discourseLinked: true,
      } as any);

      await act(async () => result.current.publishToDiscourse());

      await waitFor(() =>
        expect(result.current.publishError?.code).toBe("USER_REJECTED")
      );
      expect(trackMock).toHaveBeenCalledWith("draft_publish_failed", expect.any(Object));
    });

    it("handles createPost API errors", async () => {
      createPostMock.mockRejectedValue(new Error("create failed"));
      const { result } = renderPublishingHook({
        discourseLinked: true,
      } as any);

      await act(async () => result.current.publishToDiscourse());

      await waitFor(() =>
        expect(result.current.publishError?.code).toBe("UNKNOWN")
      );
      expect(trackMock).toHaveBeenCalledWith("draft_publish_failed", expect.any(Object));
    });
  });
});
