import React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import type {
  SignatureFetchError,
  VerificationProofResponse,
} from "@/types/verification";

export interface AlertsPanelProps {
  missingExpectations: string[];
  remoteProof: VerificationProofResponse | null;
  prefetchedProof: VerificationProofResponse | null;
  verificationId?: string;
  loading: boolean;
  fetchError: string | null;
  signatureError: SignatureFetchError | null;
  hashMismatch?: boolean;
  attestedRequestHash?: string | null;
  attestedResponseHash?: string | null;
  recordedRequestHash?: string | null;
  recordedResponseHash?: string | null;
}

export function AlertsPanel({
  missingExpectations,
  remoteProof,
  prefetchedProof,
  verificationId,
  loading,
  fetchError,
  signatureError,
  hashMismatch = false,
  attestedRequestHash,
  attestedResponseHash,
  recordedRequestHash,
  recordedResponseHash,
}: AlertsPanelProps) {
  return (
    <>
      {missingExpectations.length > 0 && !remoteProof && !prefetchedProof && (
        <Alert variant="default" className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">
            Hardware expectations required
          </AlertTitle>
          <AlertDescription className="text-amber-800">
            Provide a nonce, GPU arch, device cert hash, RIM hash, UEID, and expected measurements
            from the server to fetch or verify this proof. Missing:{" "}
            {missingExpectations.join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      {!verificationId && (
        <Alert variant="default" className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">No Verification ID</AlertTitle>
          <AlertDescription className="text-amber-800">
            Proofs are only accessible for 5 minutes after completion, or indefinitely once queried
            within that window.
          </AlertDescription>
        </Alert>
      )}

      {hashMismatch && (
        <Alert variant="default" className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">
            Signed hashes differ from session hashes
          </AlertTitle>
          <AlertDescription className="text-amber-800 space-y-1">
            <p>
              The TEE-signed request/response hashes do not match the values recorded in this
              session. We&rsquo;re using the attested hashes for verification since they are part of
              the signed payload.
            </p>
            <div className="text-[11px] font-mono break-all text-muted-foreground">
              <div>
                Signed request: {attestedRequestHash || "Unknown"}{" "}
                {recordedRequestHash &&
                  recordedRequestHash !== attestedRequestHash &&
                  `(session recorded ${recordedRequestHash})`}
              </div>
              <div>
                Signed response: {attestedResponseHash || "Unknown"}{" "}
                {recordedResponseHash &&
                  recordedResponseHash !== attestedResponseHash &&
                  `(session recorded ${recordedResponseHash})`}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Fetching cryptographic proof from TEE...</span>
        </div>
      )}

      {fetchError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to Fetch Proof</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {fetchError}
          </AlertDescription>
        </Alert>
      )}

      {signatureError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <div className="space-y-1 text-xs text-amber-900">
            <AlertTitle>Signature fetch failed</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap text-muted-foreground">
              {signatureError.message}
              {signatureError.status && (
                <span>
                  {" "}
                  (HTTP {signatureError.status}
                  {signatureError.statusText ? ` ${signatureError.statusText}` : ""})
                </span>
              )}
            </AlertDescription>
            {signatureError.url && (
              <div className="text-[11px] font-mono text-muted-foreground break-all">
                Requested: {signatureError.url}
              </div>
            )}
          </div>
        </Alert>
      )}
    </>
  );
}
