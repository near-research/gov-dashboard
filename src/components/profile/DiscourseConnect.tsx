import React, { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Link as LinkIcon,
  CheckCircle2,
  ClipboardPaste,
} from "lucide-react";
import { sign } from "near-sign-verify";
import { useNear } from "@/hooks/useNear";
import { client } from "@/lib/orpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { saveDiscourseUserApiKey } from "@/utils/discourse";
import type {
  DiscourseAuthUrl,
  DiscourseCompleteLinkResult,
} from "@/types/discourse-linkage";
import { assertSigningReady } from "@/utils/wallet/guards";
import { SIGNING_MESSAGES } from "@/constants/signing-messages";
import { NearErrorAlert } from "@/components/ui/NearErrorAlert";
import {
  createNearOperationError,
  logNearError,
  type NearOperationError,
} from "@/utils/errors/near-errors";
import { siwnRecipient } from "@/config/siwn";
import { NONCE_FRESHNESS_CHECK_MS } from "@/constants/auth";
import { logger } from "@/lib/logger";

interface DiscourseConnectProps {
  onLinked: (result: {
    discourseUsername: string;
    userApiKey?: string;
    nearAccount?: string;
  }) => void;
  onError: (error: string) => void;
}

const steps = [
  { title: "Authorize", description: "Approve access in Discourse." },
  { title: "Paste Key", description: "Copy the User API key." },
  { title: "Verify", description: "Confirm the linkage." },
];

export const DiscourseConnect = ({
  onLinked,
  onError,
}: DiscourseConnectProps) => {
  const { signedAccountId, walletSigner, signIn } = useNear();
  const isWalletReady = Boolean(walletSigner && signedAccountId);

  const [step, setStep] = useState<
    "idle" | "authorizing" | "signing" | "completing"
  >("idle");
  const [authUrl, setAuthUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [error, setError] = useState<NearOperationError | null>(null);
  const [nonceData, setNonceData] = useState<
    { nonce: string; createdAt: number } | null
  >(null);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleError = (
    errorValue: unknown,
    operationName: string,
    fallbackMessage?: string
  ) => {
    const nearError = fallbackMessage
      ? createNearOperationError(new Error(fallbackMessage))
      : createNearOperationError(errorValue);
    logNearError(operationName, nearError);
    const displayMessage = fallbackMessage ?? nearError.message;
    const errorForState = { ...nearError, message: displayMessage };
    setError(errorForState);
    onError(displayMessage);
    toast.error(displayMessage);
  };

  const clearErrors = () => {
    setError(null);
  };

  const stopPopupWatcher = () => {
    if (popupCheckRef.current) {
      clearInterval(popupCheckRef.current);
      popupCheckRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPopupWatcher();
      popupRef.current?.close();
    };
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPayload(text);
      clearErrors();
    } catch {
      handleError(
        undefined,
        "DiscourseConnect.handlePaste",
        "Unable to access clipboard. Please paste manually."
      );
    }
  };

  const startLinking = async () => {
    if (!isWalletReady) {
      handleError(
        undefined,
        "DiscourseConnect.startLinking",
        "Please connect and load your wallet first."
      );
      return;
    }

    setStep("authorizing");
    clearErrors();

    try {
      const data = (await client.discourse.initiateLink({
        clientId: "discourse-plugin",
        applicationName: "NEAR Gov",
      })) as DiscourseAuthUrl;
      setAuthUrl(data.authUrl);
      setNonceData({ nonce: data.nonce, createdAt: Date.now() });
      stopPopupWatcher();
      const popup = window.open(data.authUrl, "_blank");
      popupRef.current = popup;
      if (!popup || popup.closed) {
        handleError(
          undefined,
          "DiscourseConnect.startLinking",
          "Popup blocked. Please allow popups to continue linking."
        );
        setAuthUrl("");
        setNonceData(null);
        setStep("idle");
        return;
      }
      popupCheckRef.current = setInterval(() => {
        if (popupRef.current && popupRef.current.closed) {
          stopPopupWatcher();
          popupRef.current = null;
        }
      }, 500);
    } catch (err: unknown) {
      handleError(err, "DiscourseConnect.startLinking");
      setAuthUrl("");
      setNonceData(null);
      setStep("idle");
    }
  };

  const completeLink = async () => {
    if (!payload.trim()) {
      handleError(
        undefined,
        "DiscourseConnect.completeLink",
        "Please paste the Discourse User API key."
      );
      return;
    }

    if (!isWalletReady) {
      handleError(
        undefined,
        "DiscourseConnect.completeLink",
        "No NEAR account found. Please reconnect your wallet."
      );
      setStep("idle");
      return;
    }

    if (!nonceData) {
      handleError(
        undefined,
        "DiscourseConnect.completeLink",
        "Session expired. Please restart the linking flow."
      );
      setStep("idle");
      return;
    }

    if (
      nonceData.createdAt &&
      Date.now() - nonceData.createdAt > NONCE_FRESHNESS_CHECK_MS
    ) {
      setNonceData(null);
      setStep("idle");
      toast.error("Session Expired", {
        description: "Please start the linking process again.",
      });
      return;
    }

    setStep("signing");
    clearErrors();

    try {
      assertSigningReady(walletSigner, signedAccountId);
      const authToken = await sign(SIGNING_MESSAGES.DISCOURSE_LINK, {
        signer: walletSigner,
        recipient: siwnRecipient,
      });

      setStep("completing");

      // Complete the link via oRPC
      if (process.env.NODE_ENV === "development") {
        const trimmedPayload = payload.trim();
        logger.debug(
          "[Discourse] completing link with payload",
          trimmedPayload,
          "length",
          trimmedPayload.length
        );
      }
      const data = (await client.discourse.completeLink({
        payload: payload.trim(),
        nonce: nonceData.nonce,
        authToken,
      })) as DiscourseCompleteLinkResult;

      stopPopupWatcher();
      popupRef.current?.close();
      popupRef.current = null;
      setStep("idle");
      setPayload("");
      setNonceData(null);
      setAuthUrl("");
      saveDiscourseUserApiKey(data.userApiKey);
      toast.success(`Linked to @${data.discourseUsername}`);
      onLinked(data);
    } catch (err: unknown) {
      stopPopupWatcher();
      popupRef.current?.close();
      popupRef.current = null;
      logger.error("Discourse link error:", err);
      handleError(err, "DiscourseConnect.completeLink");
      setStep("authorizing");
    }
  };

  const renderStepIndicator = () => {
    const activeIndex = step === "idle" ? 1 : step === "authorizing" ? 2 : 3;

    return (
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          {steps.map((s, idx) => {
            const displayIndex = idx + 1;
            const isCompleted = activeIndex > displayIndex;
            const isActive = activeIndex === displayIndex;

            return (
              <div key={s.title} className="flex flex-1 items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${
                    isCompleted
                      ? "border-green-500 bg-green-500 text-white"
                      : isActive
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-muted-foreground/40 text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    displayIndex
                  )}
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`mx-3 h-0.5 flex-1 rounded-full ${
                      activeIndex > displayIndex
                        ? "bg-green-500"
                        : "bg-muted-foreground/30"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.title} className="text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">{s.title}</p>
              <p>{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (step === "idle") {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <LinkIcon className="h-6 w-6" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Link Discourse Account</h3>
          <p className="mt-1 text-sm text-slate-600">
            Connect your NEAR wallet to Discourse to publish proposals and
            collaborate with the governance community.
          </p>
        </div>
        {!isWalletReady && (
          <Alert className="border-slate-200 bg-slate-50">
            <AlertDescription data-testid="discourse-wallet-warning">
              Connect your NEAR wallet to Discourse
            </AlertDescription>
          </Alert>
        )}
        {isWalletReady && (
          <Button onClick={startLinking} className="w-full">
            <ExternalLink className="mr-2 h-4 w-4" />
            Connect to Discourse
          </Button>
        )}
        <NearErrorAlert
          error={error}
          onRetry={() => {
            clearErrors();
            void startLinking();
          }}
          onReconnect={() => {
            clearErrors();
            void signIn();
          }}
          onDismiss={clearErrors}
          className="mt-3"
        />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Complete Discourse Linking</CardTitle>
        <CardDescription>
          Follow the steps below to verify your Discourse account for{" "}
          <strong>{signedAccountId}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {renderStepIndicator()}

        <NearErrorAlert
          error={error}
          onRetry={() => {
            clearErrors();
            void completeLink();
          }}
          onReconnect={() => {
            clearErrors();
            void signIn();
          }}
          onDismiss={clearErrors}
          className="mb-3"
        />

        <Alert className="border-blue-200 bg-blue-50">
          <AlertDescription>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-blue-900">
              <li>
                Authorize the connection in the newly opened Discourse tab.
              </li>
              <li>Copy the User API key Discourse provides.</li>
              <li>Paste the key below and complete the verification.</li>
            </ol>
          </AlertDescription>
        </Alert>

        {authUrl && (
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => window.open(authUrl, "_blank")}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Reopen Discourse authorization
          </Button>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="discourse-key">Discourse User API Key</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handlePaste}
              className="gap-2"
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste from clipboard
            </Button>
          </div>
          <Textarea
            id="discourse-key"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder="Paste the User API key from Discourse..."
            rows={6}
            className="font-mono"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setStep("idle");
              clearErrors();
              setPayload("");
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={completeLink}
            disabled={
              step === "signing" || step === "completing" || !payload.trim()
            }
            className="w-full sm:w-auto"
          >
            {step === "signing" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sign in wallet...
              </>
            ) : step === "completing" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Complete Link
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
