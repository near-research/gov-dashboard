import React from "react";
import type { ModelAttestationResponse } from "@/types/verification";

export interface ModelAttestationProps {
  attestation?: ModelAttestationResponse | null;
  model?: string;
  renderCodeField: (
    label: string,
    value?: string,
    copyable?: boolean
  ) => React.ReactNode;
  renderTimestamp?: (label: string, value?: string | number) => React.ReactNode;
}

export function ModelAttestation({
  attestation,
  model,
  renderCodeField,
  renderTimestamp,
}: ModelAttestationProps) {
  const resolvedModel =
    model ||
    attestation?.model ||
    attestation?.gateway_attestation?.model ||
    attestation?.model_attestations?.[0]?.model ||
    attestation?.model_id;

  const modelValue = typeof resolvedModel === "string" ? resolvedModel : undefined;

  const issuedAt =
    attestation?.issued_at ||
    attestation?.timestamp ||
    attestation?.model_attestations?.[0]?.issued_at;
  const issuedAtValue =
    typeof issuedAt === "string" || typeof issuedAt === "number" ? issuedAt : undefined;

  return (
    <div className="space-y-3">
      {renderCodeField("Model", modelValue, false)}
      {renderTimestamp && renderTimestamp("Issued at", issuedAtValue)}
    </div>
  );
}
