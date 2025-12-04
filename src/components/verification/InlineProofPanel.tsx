import React from "react";
import { Separator } from "@/components/ui/separator";
import type { VerificationMetadata } from "@/types/agui-events";
import { shortenFingerprint } from "@/verification/normalize";

export interface InlineProofPanelProps {
  verification?: VerificationMetadata;
  renderCodeField: (label: string, value?: string, copyable?: boolean) => React.ReactNode;
  renderDataField: (
    label: string,
    value?: unknown,
    collapsible?: boolean
  ) => React.ReactNode;
}

export function InlineProofPanel({
  verification,
  renderCodeField,
  renderDataField,
}: InlineProofPanelProps) {
  return (
    <>
      <Separator />
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Inline Verification Data
        </h4>
        {renderCodeField(
          "Measurement",
          verification?.measurement && shortenFingerprint(verification.measurement)
        )}
        {renderCodeField("TEE Signature", verification?.signature)}
        {renderDataField("Attestation Report", verification?.attestationReport, true)}
        {renderDataField("Proof Payload", verification?.proof, true)}
      </div>
    </>
  );
}
