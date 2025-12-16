import type {
  ChatVerificationResult,
  VerificationMetadata,
  VerificationResult,
} from "@/lib/near-ai";
import { cn } from "@/utils/tailwind";

export type VerificationInfo =
  | VerificationResult
  | ChatVerificationResult
  | VerificationMetadata;

export interface VerificationBadgeProps {
  verification: VerificationInfo | null;
  className?: string;
}

type BadgeVariant =
  | "verified"
  | "signature"
  | "failed"
  | "pending"
  | "unknown"
  | "none";

const badgeStyles: Record<
  BadgeVariant,
  {
    container: string;
    icon: string;
    iconClass?: string;
    label: string;
  }
> = {
  verified: {
    container:
      "rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-emerald-900/40",
    icon: "✓",
    label: "Verified",
  },
  signature: {
    container:
      "rounded-full bg-emerald-600/90 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-emerald-900/40",
    icon: "✓",
    label: "Signature Valid",
  },
  failed: {
    container:
      "rounded-full bg-red-600 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-red-900/40",
    icon: "✕",
    label: "Failed",
  },
  pending: {
    container:
      "rounded-full bg-amber-500 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-amber-900/40",
    icon: "⌛",
    iconClass: "animate-pulse",
    label: "Verifying",
  },
  unknown: {
    container:
      "rounded-full bg-slate-900 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-black/40",
    icon: "?",
    label: "Unknown",
  },
  none: {
    container:
      "rounded-full bg-slate-700/80 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm shadow-black/20",
    icon: "-",
    label: "No verification",
  },
};

const isChatVerificationResult = (
  value: VerificationInfo | null
): value is ChatVerificationResult =>
  Boolean(value && typeof value === "object" && "hashValidation" in value);

const isVerificationResult = (
  value: VerificationInfo | null
): value is VerificationResult =>
  Boolean(
    value &&
      typeof value === "object" &&
      "reasons" in value &&
      "verified" in value
  );

const isVerificationMetadata = (
  value: VerificationInfo | null
): value is VerificationMetadata =>
  Boolean(
    value &&
      typeof value === "object" &&
      "status" in value &&
      !("verified" in value || "reasons" in value)
  );

const getTitleMessage = (verification: VerificationInfo | null): string => {
  if (!verification) {
    return "Verification data unavailable";
  }

  if (isChatVerificationResult(verification)) {
    if (verification.error) {
      return verification.error;
    }
    if (verification.signatureValidation?.error) {
      return verification.signatureValidation.error;
    }
    if (verification.attestation?.error) {
      return verification.attestation.error;
    }
    if (verification.warnings?.length) {
      return verification.warnings[0];
    }
    return verification.verified
      ? "Response verified by NEAR AI TEE"
      : "Verification failed";
  }

  let errorMessage: string | undefined;
  if (isVerificationResult(verification)) {
    errorMessage =
      verification.reasons?.[0] ?? verification.warnings?.[0] ?? undefined;
  } else if (isVerificationMetadata(verification)) {
    errorMessage = verification.error ?? undefined;
  }

  return errorMessage ?? "Verification status pending";
};

const getVariant = (verification: VerificationInfo | null): BadgeVariant => {
  if (!verification) return "none";

  if (isChatVerificationResult(verification)) {
    const attestationFetched = verification.attestation?.fetched !== false;
    const signatureValid =
      verification.signatureValidation?.valid ?? false;
    const signatureNotAttested =
      signatureValid &&
      verification.signatureValidation?.teeAttested === false &&
      attestationFetched;

    if (signatureNotAttested) {
      return "signature";
    }
    if (verification.verified) {
      return "verified";
    }
    if (verification.attestation?.fetched === false) {
      return "pending";
    }
    return "failed";
  }

  if (isVerificationResult(verification)) {
    if (verification.verified) {
      return "verified";
    }
    if (
      verification.reasons?.some((reason) =>
        reason?.toLowerCase().includes("signer is not in tee")
      )
    ) {
      return "signature";
    }
    if (verification.status === "pending") {
      return "pending";
    }
    return "failed";
  }

  if (isVerificationMetadata(verification)) {
    if (verification.status === "verified") {
      return "verified";
    }
    if (verification.status === "pending") {
      return "pending";
    }
    if (verification.status === "unknown") {
      return "unknown";
    }
    return "failed";
  }

  return "unknown";
};

export const VerificationBadge = ({
  verification,
  className,
}: VerificationBadgeProps) => {
  const variant = getVariant(verification);
  const tooltip = getTitleMessage(verification);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-white",
        badgeStyles[variant].container,
        className
      )}
      title={tooltip}
    >
      <span
        className={cn(
          "text-[10px] leading-none text-white",
          badgeStyles[variant].iconClass
        )}
        aria-hidden="true"
      >
        {badgeStyles[variant].icon}
      </span>
      {badgeStyles[variant].label}
    </span>
  );
};
