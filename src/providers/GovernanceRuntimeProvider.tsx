"use client";

import { useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@/lib/agui/useAgUiRuntime";
import { createGovernanceAgent } from "@/lib/governance-agent";
import { createSessionHistoryAdapter } from "@/lib/history-adapter";
import { VerificationProvider, useVerification } from "@/contexts/VerificationContext";
import type { VerificationMetadata } from "@/lib/near-ai";

export interface GovernanceRuntimeProviderProps {
  children: ReactNode;
  agentId: string;
  onError?: (error: Error) => void;
  onRunStart?: () => void;
  onRunEnd?: () => void;
}

interface RuntimeInnerProps extends GovernanceRuntimeProviderProps {}

function GovernanceRuntimeInner({
  children,
  agentId,
  onError,
  onRunStart,
  onRunEnd,
}: RuntimeInnerProps) {
  const { state, updateVerification, setStatus } = useVerification();
  const statusRef = useRef(state.status);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  const historyAdapter = useMemo(() => createSessionHistoryAdapter(), []);

  const handleVerification = useCallback(
    (metadata: VerificationMetadata) => {
      console.debug("[GovernanceRuntime] Verification event:", metadata);
      updateVerification(metadata);
    },
    [updateVerification]
  );

  const handleStateChange = useCallback((delta: unknown) => {
    console.debug("[GovernanceRuntime] State delta:", delta);
  }, []);

  const agent = useMemo(
    () =>
      createGovernanceAgent({
        agentId,
        onVerification: handleVerification,
        onStateChange: handleStateChange,
      }),
    [agentId, handleVerification, handleStateChange]
  );

  const handleError = useCallback(
    (error: Error) => {
      console.error("[GovernanceRuntime] Error:", error);
      setStatus("failed", error.message);
      onError?.(error);
    },
    [onError, setStatus]
  );

  const handleCancel = useCallback(() => {
    console.debug("[GovernanceRuntime] Cancelled");
  }, []);

  const runtime = useAgUiRuntime({
    agent,
    onError: handleError,
    onCancel: handleCancel,
    adapters: {
      history: historyAdapter,
    },
  });

  useEffect(() => {
    if (!runtime?.thread) {
      return undefined;
    }

    const unsubStart = runtime.thread.unstable_on("run-start", () => {
      setStatus("verifying");
      onRunStart?.();
    });

    const unsubEnd = runtime.thread.unstable_on("run-end", () => {
      if (statusRef.current === "verifying") {
        setStatus("pending");
      }
      onRunEnd?.();
    });

    return () => {
      unsubStart();
      unsubEnd();
    };
  }, [runtime, onRunStart, onRunEnd, setStatus]);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

export function GovernanceRuntimeProvider(props: GovernanceRuntimeProviderProps) {
  return (
    <VerificationProvider>
      <GovernanceRuntimeInner {...props} />
    </VerificationProvider>
  );
}

export { useVerification, useVerificationSafe } from "@/contexts/VerificationContext";
