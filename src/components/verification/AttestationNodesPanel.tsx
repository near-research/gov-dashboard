import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, AlertCircle, Hash } from "lucide-react";
import type { AttestationNodeSummary } from "@/types/verification";

interface NodeDisplay extends AttestationNodeSummary {
  nrasVerified?: boolean | null;
  intelVerified?: boolean | null;
}

interface AttestationNodesPanelProps {
  nodes: NodeDisplay[];
  signatureBinding: {
    matches: boolean;
    reason: string;
  };
}

const statusToneClass = (value?: boolean | null) => {
  if (value === true) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (value === false) return "bg-red-100 text-red-800 border-red-200";
  return "bg-amber-100 text-amber-900 border-amber-200";
};

const formatHash = (value?: string | null) =>
  value ? `${value.slice(0, 8)}…${value.slice(-8)}` : "Not provided";

export function AttestationNodesPanel({
  nodes,
  signatureBinding,
}: AttestationNodesPanelProps) {
  if (!nodes.length) return null;

  const copyText = (value: string | null | undefined) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Verified Attestation Nodes
          </p>
          <p className="text-[11px] text-muted-foreground">
            Signature binding:{" "}
            <span
              className={`font-semibold ${
                signatureBinding.matches
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
            >
              {signatureBinding.matches ? "Match" : "Mismatch"}
            </span>
          </p>
        </div>
        <Badge
          variant="outline"
          className={`text-[11px] ${statusToneClass(signatureBinding.matches)}`}
        >
          {signatureBinding.matches ? "Bound to attested node" : "Signature mismatch"}
        </Badge>
      </div>

      <div className="space-y-3">
        {nodes.map((node, index) => (
          <div
            key={`${node.signingAddress ?? "node"}-${index}`}
            className="rounded-xl border border-border/70 bg-white/80 p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Node {index + 1}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Signing address:
                  <span className="font-mono text-[11px] text-slate-700 ml-1 break-all">
                    {node.signingAddress || "Unknown"}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={statusToneClass(node.nrasVerified)}>
                  NRAS:{" "}
                  {node.nrasVerified === true
                    ? "Pass"
                    : node.nrasVerified === false
                    ? "Fail"
                    : "Pending"}
                </Badge>
                <Badge className={statusToneClass(node.intelVerified)}>
                  Intel:{" "}
                  {node.intelVerified === true
                    ? "Pass"
                    : node.intelVerified === false
                    ? "Fail"
                    : "Pending"}
                </Badge>
              </div>
            </div>

            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">Compose hash</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => copyText(node.composeHash)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="font-mono text-[11px] break-all">
                {formatHash(node.composeHash)}
              </p>
              {node.composeManifest && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Compose manifest snippet
                  </p>
                  <div className="rounded bg-slate-100/80 px-2 py-1 text-[10px] font-mono leading-tight text-slate-800 max-h-32 overflow-auto">
                    {node.composeManifest}
                  </div>
                </div>
              )}
              {node.nras?.reasons?.length ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    NRAS notes
                  </p>
                  <ul className="list-disc list-inside text-[11px] text-slate-700">
                    {node.nras.reasons.map((reason, idx) => (
                      <li key={`nras-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {node.intel?.reasons?.length ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Intel notes
                  </p>
                  <ul className="list-disc list-inside text-[11px] text-slate-700">
                    {node.intel.reasons.map((reason, idx) => (
                      <li key={`intel-${idx}`}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
