import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NearErrorAlert } from "@/components/ui/NearErrorAlert";
import type { NearOperationError } from "@/utils/errors/near-errors";
import { useState } from "react";

export type PublishBarProps = {
  isPassing: boolean;
  publishDisabled: boolean;
  publishLoading: boolean;
  publishError: NearOperationError | null;
  publishSuccess: string | null;
  discourseLinked: boolean;
  signedAccountId: string | null | undefined;
  linkPayload: string;
  linkError: NearOperationError | null;
  linking: boolean;
  startDiscourseLink: () => void;
  completeDiscourseLink: () => void;
  setLinkPayload: (value: string) => void;
  publishToDiscourse: () => void;
  evaluateDraft: () => void;
  evalLoading: boolean;
  clearPublishError: () => void;
  clearLinkError: () => void;
  signIn: () => void;
};

export function PublishBar({
  isPassing,
  publishDisabled,
  publishLoading,
  publishError,
  publishSuccess,
  discourseLinked,
  signedAccountId,
  linkPayload,
  linkError,
  linking,
  startDiscourseLink,
  completeDiscourseLink,
  setLinkPayload,
  publishToDiscourse,
  evaluateDraft,
  evalLoading,
  clearPublishError,
  clearLinkError,
  signIn,
}: PublishBarProps) {
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const hasWallet = Boolean(signedAccountId);
  const needsScreen = !isPassing;
  const needsWallet = isPassing && !hasWallet;
  const needsLink = isPassing && hasWallet && !discourseLinked;
  const readyToPublish = isPassing && hasWallet && discourseLinked;

  let primaryLabel = "Submit";
  let primaryOnClick = publishToDiscourse;
  let primaryDisabled = publishDisabled;
  let primaryLoading = publishLoading;
  let primaryAria: string | undefined;
  let primaryTitle: string | undefined;

  if (needsWallet) {
    primaryLabel = "Connect NEAR Wallet";
    primaryOnClick = signIn;
    primaryDisabled = false;
    primaryLoading = false;
  } else if (needsLink) {
    primaryLabel = "Link Discourse Account";
    primaryOnClick = () => {
      setIsLinkDialogOpen(true);
      void startDiscourseLink();
    };
    primaryDisabled = linking;
    primaryLoading = linking;
  } else if (readyToPublish) {
    primaryLabel = "Publish To Forum";
    primaryOnClick = publishToDiscourse;
    primaryDisabled = publishDisabled;
    primaryLoading = publishLoading;
    if (publishDisabled) {
      primaryAria = "Publish to Discourse (Resolve outstanding requirements)";
      primaryTitle = "Resolve outstanding requirements before publishing";
    }
  }

  const primaryText =
    primaryLoading && primaryLabel === "Link Discourse Account"
      ? "Linking..."
      : primaryLoading && primaryLabel === "Publish To Forum"
      ? "Publishing..."
      : primaryLabel;
  const screenButtonLabel = evalLoading ? "Evaluating..." : "Evaluate";
  const primaryButtonDisabled = needsScreen ? true : primaryDisabled;
  const primaryButtonAria = needsScreen ? "Submit" : primaryAria;
  const primaryButtonTitle = needsScreen ? "Evaluate" : primaryTitle;
  const smallButtonClass = "px-3 py-1 text-sm font-medium";
  return (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Publish to Forum</h3>
          <div className="flex items-center gap-2">
            {needsScreen && (
              <Button
                size="sm"
                className={smallButtonClass}
                onClick={evaluateDraft}
                disabled={evalLoading}
                aria-label="Run screening"
              >
                {screenButtonLabel}
              </Button>
            )}
            <Button
              size="sm"
              onClick={primaryOnClick}
              disabled={primaryButtonDisabled}
              aria-label={primaryButtonAria}
              title={primaryButtonTitle}
              className={smallButtonClass}
            >
              {primaryText}
            </Button>
          </div>
          {readyToPublish && primaryDisabled && (
            <div
              className="text-xs text-muted-foreground"
              style={{ fontSize: "0.85rem" }}
            >
              Resolve outstanding requirements to publish
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xs text-muted-foreground">
            <span
              className={`inline-flex items-center px-2 py-1 rounded-full border gap-1.5 ${
                publishDisabled
                  ? "border-gray-300 text-gray-500"
                  : "border-emerald-500 text-emerald-600"
              }`}
            >
              {publishDisabled ? "In Progress" : "Ready"}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <NearErrorAlert
          error={publishError}
          onRetry={() => {
            clearPublishError();
            void publishToDiscourse();
          }}
          onReconnect={() => {
            clearPublishError();
            void signIn();
          }}
          onDismiss={clearPublishError}
          className="mb-3"
        />
        {publishSuccess && (
          <Alert className="border-green-500 bg-green-50 text-green-900">
            <AlertDescription>
              {publishSuccess.startsWith("http") ? (
                <a
                  href={publishSuccess}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View published proposal
                </a>
              ) : (
                publishSuccess
              )}
            </AlertDescription>
          </Alert>
        )}
        {needsLink && (
          <div className="flex justify-end">
            <Button
              variant="link"
              size="sm"
              onClick={() => setIsLinkDialogOpen(true)}
            >
              Reopen link modal
            </Button>
          </div>
        )}
      </div>
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Discourse Account</DialogTitle>
            <DialogDescription>
              A new tab opened for Discourse authentication. Paste the code you
              copied from that tab below to finish linking.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={linkPayload}
            onChange={(e) => setLinkPayload(e.target.value)}
            placeholder="Paste Discourse verification code..."
            className="w-full rounded-md border px-3 py-2 text-sm"
            rows={4}
          />
          <NearErrorAlert
            error={linkError}
            onRetry={() => {
              clearLinkError();
              void completeDiscourseLink();
            }}
            onReconnect={() => {
              clearLinkError();
              void signIn();
            }}
            onDismiss={clearLinkError}
            className="mt-3"
          />
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsLinkDialogOpen(false)}
            >
              Close
            </Button>
            <Button
              onClick={() => void completeDiscourseLink()}
              disabled={linking}
            >
              {linking ? "Linking..." : "Verify & link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
