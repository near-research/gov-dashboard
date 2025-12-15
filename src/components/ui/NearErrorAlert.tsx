import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { NearOperationError } from "@/utils/errors/near-errors";

interface NearErrorAlertProps {
  error: NearOperationError | null;
  onRetry?: () => void;
  onReconnect?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function NearErrorAlert({
  error,
  onRetry,
  onReconnect,
  onDismiss,
  className,
}: NearErrorAlertProps) {
  if (!error) return null;

  return (
    <Alert variant="destructive" className={className}>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{error.message}</span>
        <div className="flex gap-2 shrink-0">
          {error.action === "reconnect" && onReconnect && (
            <Button size="sm" variant="outline" onClick={onReconnect}>
              Reconnect Wallet
            </Button>
          )}
          {error.retryable && error.action !== "reconnect" && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try Again
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
