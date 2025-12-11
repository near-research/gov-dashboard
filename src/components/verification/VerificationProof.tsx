// components/verification/VerificationProof.tsx
import React, { useMemo, useState } from "react";
import type { VerificationMetadata } from "@/types/agui-events";
import type { RemoteProof } from "@/types/verification";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VerificationStatusPill } from "@/components/verification/VerificationStatusPill";
import { ProofStatusHeader } from "@/components/verification/ProofStatusHeader";
import { VerificationTimeline } from "@/components/verification/VerificationTimeline";
import { HardwareAttestationPanel } from "@/components/verification/HardwareAttestationPanel";
import { AlertsPanel } from "@/components/verification/AlertsPanel";
import { InlineProofPanel } from "@/components/verification/InlineProofPanel";
import { AttestationDetailsPanel } from "@/components/verification/AttestationDetailsPanel";
import { AttestationNodesPanel } from "@/components/verification/AttestationNodesPanel";
import { SignatureDetailsPanel } from "@/components/verification/SignatureDetailsPanel";
import { UnrecognizedFormatPanel } from "@/components/verification/UnrecognizedFormatPanel";
import { ExternalLink } from "lucide-react";
import { ModelAttestation } from "./ModelAttestation";
import { useVerificationProof } from "./useVerificationProof";

const formatUnknown = (value: unknown) => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

interface VerificationProofProps {
  verification?: VerificationMetadata;
  verificationId?: string;
  model?: string;
  requestHash?: string;
  responseHash?: string;
  nonce?: string;
  expectedArch?: string | null;
  expectedDeviceCertHash?: string | null;
  expectedRimHash?: string | null;
  expectedUeid?: string | null;
  expectedMeasurements?: string[] | null;
  prefetchedProof?: RemoteProof | null;
  className?: string;
  triggerLabel?: string;
  autoFetch?: boolean;
}

export function VerificationProof({
  verification,
  verificationId,
  model,
  requestHash,
  responseHash,
  nonce,
  expectedArch = null,
  expectedDeviceCertHash = null,
  expectedRimHash = null,
  expectedUeid = null,
  expectedMeasurements = null,
  prefetchedProof = null,
  className,
  triggerLabel = "View proof details",
  autoFetch = false,
}: VerificationProofProps) {
  const [open, setOpen] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Record<string, boolean>>(
    {}
  );

  const {
    remoteProof,
    loading,
    fetchError,
    retrying,
    nrasError,
    nrasLoading,
    attestationSummary,
    attestationPayload,
    nrasSummary,
    nvidiaPayloadForNras,
    expectationsReady,
    intelQuote,
    canExportProof,
    hasInlineProof,
    hashMismatch,
    attestedHashes,
    verificationState,
    derivedStatus,
    attestationNodes,
    signatureBinding,
    missingExpectations,
    exportProof,
    retryFetch,
    verifyWithNRAS,
    localSignedText,
    nrasVerified,
    nrasReasons,
  } = useVerificationProof({
    open,
    autoFetch,
    verification,
    verificationId,
    model,
    requestHash,
    responseHash,
    nonce,
    expectedArch,
    expectedDeviceCertHash,
    expectedRimHash,
    expectedUeid,
    expectedMeasurements,
    prefetchedProof,
  });

  const hasAnyData = useMemo(
    () =>
      Boolean(
        verification ||
          verificationId ||
          requestHash ||
          responseHash ||
          remoteProof ||
          prefetchedProof
      ),
    [verification, verificationId, requestHash, responseHash, remoteProof, prefetchedProof]
  );

  if (!hasAnyData) return null;

  const renderCodeField = (label: string, value?: string, copyable = true) => {
    if (!value) return null;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {copyable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(value);
              }}
            >
              Copy
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[12px] leading-relaxed break-all overflow-hidden font-mono">
          {value}
        </div>
      </div>
    );
  };

  const renderDataField = (
    label: string,
    value?: unknown,
    collapsible = false
  ) => {
    if (!value) return null;

    const isExpanded =
      !collapsible || expandedFields[label] !== undefined
        ? expandedFields[label] ?? true
        : true;

    const toggle = () =>
      setExpandedFields((prev) => ({ ...prev, [label]: !isExpanded }));

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {collapsible && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={toggle}
            >
              {isExpanded ? "Collapse" : "Expand"}
            </Button>
          )}
        </div>
        {isExpanded && (
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 max-h-[200px] overflow-auto">
            <pre className="text-[12px] whitespace-pre-wrap break-all leading-relaxed overflow-hidden font-mono">
              {typeof value === "string" ? value : formatUnknown(value)}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderTimestamp = (label: string, value?: string | number) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return renderCodeField(label, date.toLocaleString(), false);
  };

  return (
    <>
      <VerificationStatusPill
        status={derivedStatus}
        className={className}
        onClick={() => setOpen(true)}
        label={triggerLabel}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl w-[95vw] sm:max-w-5xl sm:w-full max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="sr-only">Verification proof</DialogTitle>
            <DialogDescription className="sr-only">
              Detailed verification proof details and hardware attestation
              results.
            </DialogDescription>
            <ProofStatusHeader
              status={derivedStatus}
              verificationState={verificationState}
              configMissing={remoteProof?.configMissing}
              nrasError={nrasError}
              fetchError={fetchError}
              canExportProof={canExportProof}
              onExportProof={exportProof}
              onRetryFetch={retryFetch}
              retrying={retrying}
            />
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1">
            <div className="space-y-5 text-sm px-2 pb-2">
              {loading && (
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-4 bg-muted rounded animate-pulse" />
                  <div className="h-4 bg-muted rounded animate-pulse" />
                </div>
              )}

              {remoteProof && (
                <VerificationTimeline verificationState={verificationState} />
              )}

              {attestationSummary && (
                <HardwareAttestationPanel
                  attestationSummary={attestationSummary}
                  nrasSummary={nrasSummary}
                  nvidiaPayloadForNras={nvidiaPayloadForNras}
                  nrasError={nrasError}
                  nrasLoading={nrasLoading}
                  expectationsReady={expectationsReady}
                  intelQuote={intelQuote}
                  canExportProof={canExportProof}
                  onVerifyWithNRAS={verifyWithNRAS}
                  onExportProof={exportProof}
                  configMissing={remoteProof?.configMissing}
                  model={model}
                />
              )}

              {attestationNodes?.length ? (
                <AttestationNodesPanel
                  nodes={attestationNodes}
                  signatureBinding={signatureBinding}
                />
              ) : null}

              <AlertsPanel
                missingExpectations={missingExpectations}
                remoteProof={remoteProof}
                prefetchedProof={prefetchedProof}
                verificationId={verificationId}
                loading={loading}
                fetchError={fetchError}
                signatureError={remoteProof?.signatureError ?? null}
                hashMismatch={hashMismatch}
                attestedRequestHash={attestedHashes?.requestHash}
                attestedResponseHash={attestedHashes?.responseHash}
                recordedRequestHash={
                  remoteProof?.sessionRequestHash ||
                  remoteProof?.requestHash ||
                  requestHash ||
                  null
                }
                recordedResponseHash={
                  remoteProof?.sessionResponseHash ||
                  remoteProof?.responseHash ||
                  responseHash ||
                  null
                }
                nrasReasons={nrasReasons}
                nrasVerified={nrasVerified ?? null}
              />

              {hasInlineProof && (
                <InlineProofPanel
                  verification={verification}
                  renderCodeField={renderCodeField}
                  renderDataField={renderDataField}
                />
              )}

              {verification?.attestationUrl && (
                <a
                  href={verification.attestationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                >
                  View full attestation report
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {attestationPayload && (
                <AttestationDetailsPanel
                  attestationPayload={attestationPayload}
                  renderCodeField={renderCodeField}
                />
              )}

              {remoteProof?.signature && (
                <SignatureDetailsPanel
                  signaturePayload={remoteProof.signature}
                  localSignedText={localSignedText}
                  renderCodeField={renderCodeField}
                />
              )}

              {remoteProof?.attestation && (
                <ModelAttestation
                  attestation={remoteProof.attestation}
                  renderCodeField={renderCodeField}
                  renderTimestamp={renderTimestamp}
                />
              )}

              {remoteProof && !remoteProof.signature && !remoteProof.attestation && (
                <UnrecognizedFormatPanel
                  remoteProof={remoteProof}
                  renderDataField={renderDataField}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
