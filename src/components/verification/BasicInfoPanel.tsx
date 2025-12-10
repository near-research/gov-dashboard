import React from "react";
import type { VerificationMetadata } from "@/types/agui-events";
import type { VerificationProofResponse } from "@/types/verification";

export interface BasicInfoPanelProps {
  verificationId?: string;
  model?: string;
  verification?: VerificationMetadata;
  requestHash?: string;
  responseHash?: string;
  remoteProof: VerificationProofResponse | null;
  renderCodeField: (
    label: string,
    value?: string,
    copyable?: boolean
  ) => React.ReactNode;
  renderTimestamp: (
    label: string,
    value?: string | number
  ) => React.ReactNode;
}

export function BasicInfoPanel({
  verificationId,
  model,
  verification,
  requestHash,
  responseHash,
  remoteProof,
  renderCodeField,
  renderTimestamp,
}: BasicInfoPanelProps) {
  return (
    <div className="space-y-3">
      {renderCodeField("Verification ID", verificationId)}
      {renderCodeField("Model", model, false)}
      {renderCodeField("Request Hash (SHA-256)", requestHash)}
      {renderCodeField("Response Hash (SHA-256)", responseHash)}
      {renderTimestamp("Issued At", verification?.issuedAt)}
      {renderTimestamp(
        "JWT Issued At",
        typeof remoteProof?.nras?.claims?.iat === "number"
          ? remoteProof.nras?.claims?.iat
          : undefined
      )}
      {renderTimestamp(
        "JWT Exp",
        typeof remoteProof?.nras?.claims?.exp === "number"
          ? remoteProof.nras?.claims?.exp
          : undefined
      )}
    </div>
  );
}
