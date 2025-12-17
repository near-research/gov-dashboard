"use client";

import { useMemo, useState } from "react";
import { useVerificationSafe } from "@/contexts/VerificationContext";
import {
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/utils/tailwind";

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3 h-3 text-green-500" />
      ) : (
        <Copy className="w-3 h-3 text-gray-400" />
      )}
    </button>
  );
}

function DetailRow({
  label,
  value,
  copyable = false,
  truncate = false,
}: {
  label: string;
  value: string | undefined | null;
  copyable?: boolean;
  truncate?: boolean;
}) {
  if (!value) return null;

  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-gray-500 dark:text-gray-400 min-w-[100px] flex-shrink-0">
        {label}:
      </span>
      <span
        className={cn(
          "text-gray-900 dark:text-gray-100 font-mono text-xs break-all",
          truncate && "truncate max-w-[200px]"
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
      {copyable && <CopyButton text={value} />}
    </div>
  );
}

export function VerificationPanel() {
  const verification = useVerificationSafe();
  const [expanded, setExpanded] = useState(false);

  const statusConfig = useMemo(() => {
    const base = {
      idle: {
        Icon: Shield,
        bg: "bg-gray-50 dark:bg-gray-900/40",
        border: "border-gray-200 dark:border-gray-700",
        text: "text-gray-600 dark:text-gray-400",
        label: "Verification Pending",
        description: "Send a message to start verification.",
        spin: false,
      },
      pending: {
        Icon: Loader2,
        bg: "bg-yellow-50 dark:bg-yellow-900/20",
        border: "border-yellow-200 dark:border-yellow-800",
        text: "text-yellow-700 dark:text-yellow-400",
        label: "Initializing Verification",
        description: "Setting up a secure verification session...",
        spin: true,
      },
      verifying: {
        Icon: Loader2,
        bg: "bg-yellow-50 dark:bg-yellow-900/20",
        border: "border-yellow-200 dark:border-yellow-800",
        text: "text-yellow-700 dark:text-yellow-400",
        label: "Verifying Agent",
        description: "Validating TEE attestation and hashes...",
        spin: true,
      },
      verified: {
        Icon: ShieldCheck,
        bg: "bg-green-50 dark:bg-green-900/20",
        border: "border-green-200 dark:border-green-800",
        text: "text-green-700 dark:text-green-400",
        label: "Agent Verified",
        description: "Running in a verified Trusted Execution Environment.",
        spin: false,
      },
      failed: {
        Icon: ShieldAlert,
        bg: "bg-red-50 dark:bg-red-900/20",
        border: "border-red-200 dark:border-red-800",
        text: "text-red-700 dark:text-red-400",
        label: "Verification Failed",
        description: "Unable to confirm the agent's integrity.",
        spin: false,
      },
      unknown: {
        Icon: ShieldAlert,
        bg: "bg-gray-50 dark:bg-gray-900/40",
        border: "border-gray-200 dark:border-gray-700",
        text: "text-gray-600 dark:text-gray-400",
        label: "Verification Unknown",
        description: "Verification data is unavailable.",
        spin: false,
      },
    } as const;

    return base;
  }, []);

  if (!verification) {
    return null;
  }

  const { status, metadata, error, lastUpdated } = verification.state;
  const config = statusConfig[status] ?? statusConfig.failed;

  return (
    <div className={cn("border rounded-lg overflow-hidden", config.border)}>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "w-full p-3 flex items-center justify-between transition-colors",
          config.bg,
          "hover:opacity-90"
        )}
      >
        <div className="flex items-center gap-3">
          <config.Icon
            className={cn("w-5 h-5", config.text, config.spin && "animate-spin")}
          />
          <div className="text-left">
            <div className={cn("font-medium text-sm", config.text)}>{config.label}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {status === "failed" && error ? error : config.description}
            </div>
          </div>
        </div>
        {metadata && (
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            )}
          </div>
        )}
      </button>

      {expanded && metadata && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 space-y-3">
          <DetailRow label="Chat ID" value={metadata.chatId} copyable truncate />
          <DetailRow label="Message ID" value={metadata.messageId} copyable truncate />
          <DetailRow label="Request Hash" value={metadata.requestHash} copyable truncate />
          <DetailRow label="Response Hash" value={metadata.responseHash} copyable truncate />
          {metadata.status && (
            <DetailRow
              label="Verification Status"
              value={metadata.status}
              copyable={false}
            />
          )}
          {metadata.source && (
            <DetailRow label="Source" value={metadata.source} />
          )}
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {lastUpdated && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Last updated {lastUpdated.toLocaleString()}
            </div>
          )}
          <a
            href="https://docs.near.ai/verification"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2"
          >
            Learn about TEE verification
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}
