import React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { shortenFingerprint } from "@/utils/verification";
import {
  ExternalLink,
  Loader2,
  AlertCircle,
  Cpu,
  Gpu,
  Copy,
} from "lucide-react";
import { toast } from "sonner";

export interface HardwareAttestationPanelProps {
  attestationSummary: {
    gpu: string;
    driver: string;
    vbios: string;
    nonce: string;
    oem?: string;
    secboot: string;
    dbgstat: string;
    attestationResult: string | null;
    hasHardwareDetails: boolean;
    verifiedHardware: boolean;
    hardwareReason?: string;
    gpuVerified: boolean;
    intelConfigured: boolean;
    fullVerification: boolean;
  };
  nrasSummary: {
    verified: boolean;
    jwt: string | null;
    claims: any;
    gpus: any;
    raw: any;
  } | null;
  nvidiaPayloadForNras: any | null;
  nrasError: string | null;
  nrasLoading: boolean;
  expectationsReady: boolean;
  intelQuote: string | null;
  canExportProof: boolean;
  onVerifyWithNRAS: () => void;
  onExportProof: () => void;
  configMissing?: { intel?: boolean; intelApiKey?: boolean };
  model?: string;
}

export function HardwareAttestationPanel({
  attestationSummary,
  nrasSummary,
  nvidiaPayloadForNras,
  nrasError,
  nrasLoading,
  expectationsReady,
  intelQuote,
  canExportProof,
  onVerifyWithNRAS,
  onExportProof,
  configMissing,
  model,
}: HardwareAttestationPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold uppercase text-muted-foreground">
          Model Attestation
        </h4>
        <div className="me-2 flex items-center gap-2">
          <div>
            <span className="font-mono text-[10px]]">{model}</span>
          </div>
        </div>
      </div>

      {attestationSummary.gpuVerified && (
        <Alert variant="default" className="border-blue-200 bg-blue-50/50">
          <div className="space-y-3">
            {nrasSummary?.jwt ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-3 py-2 bg-muted/30 rounded-lg min-w-[260px]">
                <span className="inline-flex items-center gap-2">
                  <Gpu className="h-4 w-4 text-blue-800" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight">
                      NVIDIA Report
                    </p>
                  </div>
                </span>
                <div className="flex items-center gap-1 flex-shrink-0 text-xs">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      if (!nrasSummary?.jwt) return;
                      navigator.clipboard.writeText(nrasSummary.jwt);
                      toast.success("NRAS JWT copied!", {
                        description: "Decode at jwt.io",
                      });
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    asChild
                  >
                    <a
                      href="https://jwt.io/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              nvidiaPayloadForNras && (
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Gpu className="h-4 w-4 text-emerald-600" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-tight">
                          NVIDIA Payload
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={nrasLoading || !expectationsReady}
                      onClick={onVerifyWithNRAS}
                    >
                      {nrasLoading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Checking...
                        </span>
                      ) : (
                        "Verify"
                      )}
                    </Button>
                  </div>
                  {nrasError && (
                    <p className="text-[10px] text-red-600 leading-snug">
                      {nrasError}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        </Alert>
      )}

      {configMissing?.intel && intelQuote && (
        <Alert variant="default" className="border-blue-200 bg-blue-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-3 py-2 bg-muted/30 rounded-lg min-w-[260px]">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="h-4 w-4 text-blue-800" />
              <div className="min-w-0">
                <p className="text-xs font-semibold leading-tight">
                  Intel TDX Quote
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(intelQuote);
                  toast.success("Intel quote copied!", {
                    description: "Paste at proof.t16z.com",
                  });
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                <a
                  href="https://proof.t16z.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {configMissing?.intelApiKey && (
        <Alert
          variant="default"
          className="border-amber-200 bg-amber-50 text-amber-900 flex items-center gap-2 px-3 py-2 h-auto"
        >
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <div className="text-xs">
            Intel API key missing; configure INTEL_TDX_API_KEY.
          </div>
        </Alert>
      )}
    </div>
  );
}
