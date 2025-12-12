import React from "react";
import { cn } from "@/utils/tailwind";
import type { VerificationStatus } from "@/types/agui-events";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";

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

export interface VerificationStatusPillProps {
  status: VerificationStatus;
  className?: string;
  onClick: () => void;
  label?: string;
}

export function VerificationStatusPill({
  status,
  className,
  onClick,
  label,
}: VerificationStatusPillProps) {
  const StatusIcon = statusIcon[status];
  const title = label || "View verification proof";

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid="verification-proof-trigger"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        statusTone[status],
        className
      )}
    >
      <StatusIcon className="h-3 w-3" />
      {statusLabel[status]}
    </button>
  );
}
