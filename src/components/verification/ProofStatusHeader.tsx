import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { VerificationStatus } from "@/types/agui-events";
import { cn } from "@/utils/tailwind";
import { deriveVerificationState } from "@/utils/attestation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
} from "lucide-react";

const statusTone: Record<VerificationStatus, string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  unknown: "bg-slate-100 text-slate-900 border-slate-200",
};

const statusLabel: Record<VerificationStatus, string> = {
  pending: "Pending",
  verified: "Verified",
  failed: "Failed",
  unknown: "Unknown",
};

const statusIcon: Record<VerificationStatus, typeof CheckCircle2> = {
  pending: Clock,
  verified: CheckCircle2,
  failed: AlertCircle,
  unknown: AlertCircle,
};

export interface ProofStatusHeaderProps {
  status: VerificationStatus;
  verificationState: ReturnType<typeof deriveVerificationState>;
  configMissing?: { nearApiKey?: boolean; intel?: boolean; intelApiKey?: boolean };
  nrasError: string | null;
  fetchError: string | null;
  canExportProof: boolean;
  onExportProof: () => void;
  onRetryFetch: () => void;
  retrying: boolean;
}

export function ProofStatusHeader({
  status,
  verificationState,
  configMissing,
  nrasError,
  fetchError,
  canExportProof,
  onExportProof,
  onRetryFetch,
  retrying,
}: ProofStatusHeaderProps) {
  const StatusIcon = statusIcon[status];

  return (
    <div className="flex items-center gap-3 flex-wrap justify-start">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 h-9",
          statusTone[status]
        )}
      >
        <StatusIcon className="h-4 w-4" />
        <p className="font-semibold text-sm leading-none">
          {statusLabel[status]}
        </p>
      </div>

      {configMissing?.nearApiKey && (
        <Alert
          variant="default"
          className="border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-2 px-3 py-2 h-auto"
        >
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <div className="text-xs">
            NEAR API key not configured. Cannot fetch proofs.
          </div>
        </Alert>
      )}

      {verificationState.overall !== "verified" &&
        (verificationState.reasons?.length || nrasError) && (
          <Alert
            variant="default"
            className="border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-2 px-3 py-2 h-auto"
          >
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <div className="text-xs space-y-1">
              {verificationState.reasons?.map((reason, idx) => (
                <div key={idx}>{reason}</div>
              ))}
              {nrasError && <div>{nrasError}</div>}
            </div>
          </Alert>
        )}

      <Button
        type="button"
        size="sm"
        variant="default"
        disabled={!canExportProof}
        onClick={onExportProof}
        className="text-xs bg-black text-white hover:bg-black/90 gap-2 h-9 px-3"
      >
        <Download className="h-3 w-3" />
        Export Proof
      </Button>

      {fetchError && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetryFetch}
          className="text-xs gap-2 h-9 px-3"
          disabled={retrying}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
