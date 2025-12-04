import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type PublishStep = { label: string; done: boolean; blocked?: boolean };

export type PublishBarProps = {
  publishSteps: PublishStep[];
  publishDisabled: boolean;
  publishLoading: boolean;
  publishError: string;
  publishSuccess: string | null;
  discourseLinked: boolean;
  signedAccountId: string | null | undefined;
  linkPayload: string;
  linkError: string;
  linking: boolean;
  startDiscourseLink: () => void;
  completeDiscourseLink: () => void;
  setLinkPayload: (value: string) => void;
  publishToDiscourse: () => void;
  signIn: () => void;
};

export function PublishBar({
  publishSteps,
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
  signIn,
}: PublishBarProps) {
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Publish to Discourse</h3>
          <p className="text-muted-foreground text-sm">
            Complete the checklist and publish your proposal.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          <span
            className="inline-flex items-center px-2 py-1 rounded-full border"
            style={{
              gap: "6px",
              borderColor: publishDisabled ? "#f59e0b" : "#10b981",
              color: publishDisabled ? "#f59e0b" : "#065f46",
            }}
          >
            {publishDisabled ? "In Progress" : "Ready"}
          </span>
        </div>
      </div>
      <div className="grid gap-3 mt-3">
        <div className="flex items-center gap-3">
          {publishSteps.map((step, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2"
              style={{
                opacity: step.blocked ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  border: "2px solid",
                  borderColor: step.done ? "#10b981" : "#d1d5db",
                  background: step.done ? "#d1fae5" : "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.85rem",
                  color: step.done ? "#065f46" : "#6b7280",
                }}
              >
                {step.done ? "✓" : idx + 1}
              </div>
              <div>
                <p className="font-medium text-sm">{step.label}</p>
                {step.blocked && (
                  <p className="text-xs text-muted-foreground">
                    Complete required steps first
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        {publishError && (
          <Alert className="border-red-500 bg-red-50 text-red-900">
            <AlertDescription>{publishError}</AlertDescription>
          </Alert>
        )}
        {publishSuccess && (
          <Alert className="border-green-500 bg-green-50 text-green-900">
            <AlertDescription>
              {publishSuccess.startsWith("http") ? (
                <a href={publishSuccess} target="_blank" rel="noreferrer" className="underline">
                  View published proposal
                </a>
              ) : (
                publishSuccess
              )}
            </AlertDescription>
          </Alert>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "0.75rem",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            border: "1px dashed #d1d5db",
            background: "#f9fafb",
          }}
        >
          <PublishStepBadge label="Screened" done />
          <PublishStepBadge label="Connect NEAR account" done={Boolean(signedAccountId)} />
          <PublishStepBadge label="Link Discourse" done={discourseLinked} />
        </div>
        {!signedAccountId && (
          <Button onClick={signIn} className="w-full">
            Connect NEAR account
          </Button>
        )}
        {signedAccountId && !discourseLinked && (
          <Button variant="outline" onClick={startDiscourseLink} className="w-full">
            Link Discourse account
          </Button>
        )}
        <div style={{ position: "relative" }}>
          <Button
            onClick={publishToDiscourse}
            disabled={publishDisabled}
            className="w-full"
            aria-label={publishDisabled ? "Complete steps to publish" : undefined}
            title={publishDisabled ? "Complete steps to publish" : undefined}
          >
            {publishLoading ? "Publishing..." : "Publish to Discourse"}
          </Button>
          {publishDisabled && (
            <div
              style={{
                fontSize: "0.85rem",
                color: "#6b7280",
                marginTop: "0.35rem",
                textAlign: "center",
              }}
            >
              Finish the checklist to publish
            </div>
          )}
        </div>
        {!discourseLinked && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Paste the User API key from the Discourse tab after you authorize.
            </p>
            <textarea
              value={linkPayload}
              onChange={(e) => setLinkPayload(e.target.value)}
              placeholder="Paste User API key..."
              className="w-full rounded-md border px-3 py-2 text-sm"
              rows={3}
            />
            {linkError && (
              <Alert className="border-red-500 bg-red-50 text-red-900">
                <AlertDescription>{linkError}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={startDiscourseLink} disabled={linking} className="w-1/2">
                Get auth link
              </Button>
              <Button onClick={completeDiscourseLink} disabled={linking} className="w-1/2">
                {linking ? "Linking..." : "Verify & link"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PublishStepBadge({ label, done }: { label: string; done: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        color: done ? "#065f46" : "#6b7280",
        fontWeight: done ? 600 : 500,
      }}
    >
      <div
        style={{
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          border: "2px solid",
          borderColor: done ? "#10b981" : "#d1d5db",
          background: done ? "#d1fae5" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.75rem",
          color: done ? "#065f46" : "#6b7280",
        }}
      >
        {done ? "✓" : "•"}
      </div>
      <span>{label}</span>
    </div>
  );
}
