import type { GovernanceEvents } from "@/types/analytics";
import type { NearOperationError } from "./near-errors";
import { createNearOperationError } from "./near-errors";

type ScreeningFailureEvents =
  | "screening_auth_failed"
  | "screening_duplicate"
  | "screening_rate_limited";

type ScreeningShouldTrack = {
  [K in ScreeningFailureEvents]: {
    event: K;
    props: GovernanceEvents[K];
  };
}[ScreeningFailureEvents];

export interface ScreeningApiResult {
  success: boolean;
  error?: NearOperationError;
  data?: unknown;
  shouldTrack?: ScreeningShouldTrack;
}

export function handleScreeningResponse(
  response: Response,
  context: { topicId: string; revisionNumber?: number; accountId: string },
  payload?: Record<string, unknown> | null
): ScreeningApiResult {
  const { topicId, revisionNumber, accountId } = context;
  const revisionInfo = revisionNumber ? ` revision ${revisionNumber}` : "";
  const baseTrackingProps = {
    topic_id: topicId,
    revision: revisionNumber ?? null,
    account_id: accountId,
  };
  const payloadMessage =
    payload && typeof payload.error === "string"
      ? payload.error
      : payload && typeof payload.message === "string"
      ? payload.message
      : undefined;

  if (response.ok) {
    return { success: true };
  }

  switch (response.status) {
    case 401: {
    const fallbackMessage = "Authentication failed. Please try signing again.";
    const message = payloadMessage
      ? `${fallbackMessage} (${payloadMessage})`
      : fallbackMessage;
      return {
        success: false,
        error: createNearOperationError(new Error(message)),
        shouldTrack: {
          event: "screening_auth_failed",
          props: {
            ...baseTrackingProps,
            message,
            code: response.status,
          },
        },
      };
    }
    case 409: {
      const message = "This proposal revision has already been evaluated.";
      return {
        success: false,
        error: createNearOperationError(new Error(message)),
        shouldTrack: {
          event: "screening_duplicate",
          props: {
            ...baseTrackingProps,
            message,
            code: response.status,
          },
        },
      };
    }
    case 429: {
      const message = "Rate limit exceeded. Please try again later.";
      return {
        success: false,
        error: createNearOperationError(new Error(message)),
        shouldTrack: {
          event: "screening_rate_limited",
          props: {
            ...baseTrackingProps,
            message,
            code: response.status,
          },
        },
      };
    }
    default: {
      const message =
        payloadMessage ??
        response.statusText ??
        `Screening failed with status ${response.status}`;
      return {
        success: false,
        error: createNearOperationError(new Error(message)),
      };
    }
  }
}
