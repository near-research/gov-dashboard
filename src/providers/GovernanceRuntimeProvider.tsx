"use client";

import { useMemo, useCallback, type ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
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
}: RuntimeInnerProps) {
  const { updateVerification, setStatus } = useVerification();

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
