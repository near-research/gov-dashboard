import { describe, expect, it, vi } from "vitest";

import {
  AnalyticsUnavailableError,
  GovernanceAnalytics,
} from "@/lib/analytics";
import type { GovernanceEvents } from "@/types/analytics";

describe("GovernanceAnalytics", () => {
  it("forwards events and payloads to the provider", () => {
    const track = vi.fn();
    const analytics = new GovernanceAnalytics({ track });

    analytics.trackEvent("draft_evaluation_started", {
      props: { content_length: 120 },
    });

    expect(track).toHaveBeenCalledWith("draft_evaluation_started", {
      content_length: 120,
    });
  });

  it("routes user identification to the provider when available", () => {
    const identify = vi.fn();
    const analytics = new GovernanceAnalytics({
      track: vi.fn(),
      identify,
    });

    analytics.identifyUser("alice.near", { loyalty: "core" });

    expect(identify).toHaveBeenCalledWith("alice.near", {
      loyalty: "core",
    });
  });

  it("tracks page views when the provider exposes a page helper", () => {
    const page = vi.fn();
    const analytics = new GovernanceAnalytics({
      track: vi.fn(),
      page,
    });
    const pageViewProps: GovernanceEvents["page_view"] = {
      path: "/proposals/42",
      referrer: "https://app.near.org",
    };

    analytics.trackPageView(pageViewProps);

    expect(page).toHaveBeenCalledWith("/proposals/42", pageViewProps);
  });

  it("falls back to tracking a `page_view` event when the provider lacks a page helper", () => {
    const track = vi.fn();
    const analytics = new GovernanceAnalytics({ track });
    const pageViewProps: GovernanceEvents["page_view"] = {
      path: "/proposals/23",
    };

    analytics.trackPageView(pageViewProps);

    expect(track).toHaveBeenCalledWith("page_view", pageViewProps);
  });

  it("throws when the analytics provider is unavailable", () => {
    const analytics = new GovernanceAnalytics(null);

    expect(() =>
      analytics.trackEvent("draft_publish_clicked"),
    ).toThrow(AnalyticsUnavailableError);
  });

  it("respects privacy mode and allows toggling it off", () => {
    const track = vi.fn();
    const identify = vi.fn();
    const page = vi.fn();
    const analytics = new GovernanceAnalytics(
      { track, identify, page },
      true,
    );
    const pageViewProps: GovernanceEvents["page_view"] = {
      path: "/privacy",
    };

    analytics.trackEvent("draft_publish_clicked");
    analytics.identifyUser("privacy.near");
    analytics.trackPageView(pageViewProps);

    expect(track).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();

    analytics.setPrivacyMode(false);

    analytics.trackEvent("draft_publish_clicked");

    expect(track).toHaveBeenCalled();
  });
});
