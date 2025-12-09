import { usePlausible } from "next-plausible";
import type { GovernanceEvents } from "@/types/analytics";

type EmptyObject = Record<string, never>;

type GovernanceEventOptions<K extends keyof GovernanceEvents> = GovernanceEvents[K] extends EmptyObject
  ? { props?: GovernanceEvents[K] }
  : { props: GovernanceEvents[K] };

export type GovernanceTrackFn = <K extends keyof GovernanceEvents>(
  event: K,
  ...args: GovernanceEvents[K] extends EmptyObject
    ? [options?: GovernanceEventOptions<K>]
    : [options: GovernanceEventOptions<K>]
) => void;

export class AnalyticsUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "Analytics provider is not available");
    this.name = "AnalyticsUnavailableError";
  }
}

export interface AnalyticsProvider {
  track: (event: string, props?: Record<string, unknown>) => void;
  identify?: (distinctId: string, traits?: Record<string, unknown>) => void;
  page?: (path: string, props?: Record<string, unknown>) => void;
}

export class GovernanceAnalytics {
  private privacyMode = false;

  constructor(private provider: AnalyticsProvider | null, privacyMode = false) {
    this.privacyMode = privacyMode;
  }

  trackEvent<K extends keyof GovernanceEvents>(event: K, options?: GovernanceEventOptions<K>): void {
    if (this.privacyMode) {
      return;
    }

    const track = this.provider?.track;
    if (!track) {
      throw new AnalyticsUnavailableError();
    }

    track(event, options?.props);
  }

  identifyUser(distinctId: string, traits?: Record<string, unknown>): void {
    if (this.privacyMode) {
      return;
    }

    const identify = this.provider?.identify;
    if (!identify) {
      return;
    }

    identify(distinctId, traits);
  }

  trackPageView(props: GovernanceEvents["page_view"]): void {
    if (this.privacyMode) {
      return;
    }

    if (!this.provider) {
      throw new AnalyticsUnavailableError();
    }

    if (typeof this.provider.page === "function") {
      this.provider.page(props.path, props);
      return;
    }

    this.provider.track("page_view", props);
  }

  setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
  }

  isPrivacyModeEnabled(): boolean {
    return this.privacyMode;
  }
}

export function useGovernanceAnalytics(): GovernanceTrackFn {
  const plausible = usePlausible();
  const analytics = new GovernanceAnalytics({
    track: (event, props) => plausible(event, { props }),
  });

  return <K extends keyof GovernanceEvents>(
    event: K,
    ...args: GovernanceEvents[K] extends EmptyObject
      ? [options?: GovernanceEventOptions<K>]
      : [options: GovernanceEventOptions<K>]
  ) => {
    const options = args[0] as GovernanceEventOptions<K> | undefined;
    analytics.trackEvent(event, options);
  };
}
