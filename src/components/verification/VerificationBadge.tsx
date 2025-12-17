"use client";

import { Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import { cn } from "@/utils/tailwind";

interface Props {
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function VerificationBadge({ className, showLabel = false, size = "sm" }: Props) {
  const verification = useVerificationSafe();

  if (!verification || verification.state.status === "idle") {
    return null;
  }

  const { status } = verification.state;
  const iconSizeClass = size === "sm" ? "w-3 h-3" : "w-4 h-4";

  const config = {
    pending: {
      Icon: Loader2,
      color: "text-yellow-500",
      label: "Verifying",
      spin: true,
    },
    verifying: {
      Icon: Loader2,
      color: "text-yellow-500",
      label: "Verifying",
      spin: true,
    },
    verified: {
      Icon: ShieldCheck,
      color: "text-green-500",
      label: "Verified",
      spin: false,
    },
    failed: {
      Icon: ShieldAlert,
      color: "text-red-500",
      label: "Failed",
      spin: false,
    },
    unknown: {
      Icon: Shield,
      color: "text-gray-500",
      label: "Unknown",
      spin: false,
    },
  } as const;

  const current = config[status];
  if (!current) {
    return null;
  }

  const Icon = current.Icon;

  return (
    <span className={cn("inline-flex items-center gap-1", current.color, className)}>
      <Icon
        className={cn(iconSizeClass, current.spin && "animate-spin")}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={cn("text-xs font-medium", current.color)}>{current.label}</span>
      )}
    </span>
  );
}
