import React from "react";
import { Separator } from "@/components/ui/separator";
import { shortenFingerprint } from "@/verification/normalize";

export interface AttestationDetailsPanelProps {
  attestationPayload: {
    signingAddress?: string | null;
    signingAlgo?: string | null;
    reportData?: string | null;
    requestNonce?: string | null;
    raw?: any;
  } | null;
  renderCodeField: (
    label: string,
    value?: string,
    copyable?: boolean
  ) => React.ReactNode;
}

export function AttestationDetailsPanel({
  attestationPayload,
  renderCodeField,
}: AttestationDetailsPanelProps) {
  if (!attestationPayload) return null;

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          TEE Attestation
        </h4>
        {renderCodeField(
          "TEE Signing Address",
          attestationPayload.signingAddress || undefined
        )}
        {renderCodeField(
          "Signing Algorithm",
          attestationPayload.signingAlgo || undefined,
          false
        )}
        {renderCodeField(
          "Report Data Hash",
          attestationPayload.reportData
            ? shortenFingerprint(attestationPayload.reportData)
            : undefined
        )}
        {renderCodeField(
          "Request Nonce",
          attestationPayload.requestNonce
            ? shortenFingerprint(attestationPayload.requestNonce, 12)
            : undefined
        )}
      </div>
    </>
  );
}
