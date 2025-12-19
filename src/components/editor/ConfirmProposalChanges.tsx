"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { diffPartialText } from "@/utils/ui/diff";

interface ConfirmProposalChangesProps {
  originalTitle: string;
  originalContent: string;
  newTitle: string;
  newContent: string;
  onAccept: () => void;
  onReject: () => void;
  status: "pending" | "accepted" | "rejected";
}

export function ConfirmProposalChanges({
  originalTitle,
  originalContent,
  newTitle,
  newContent,
  onAccept,
  onReject,
  status,
}: ConfirmProposalChangesProps) {
  const titleDiff = diffPartialText(originalTitle, newTitle);
  const contentDiff = diffPartialText(originalContent, newContent);

  if (status !== "pending") {
    return (
      <Card className="p-4 my-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {status === "accepted" ? "✓ Changes accepted" : "✗ Changes rejected"}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 my-4 border-2 border-blue-200">
      <h3 className="font-bold mb-4 text-base">Confirm Proposal Changes</h3>

      {originalTitle !== newTitle && (
        <div className="mb-4">
          <div className="text-sm text-muted-foreground mb-1">Title:</div>
          <div
            className="p-2 bg-muted rounded text-sm diff-content"
            dangerouslySetInnerHTML={{ __html: titleDiff }}
          />
        </div>
      )}

      <div className="mb-6">
        <div className="text-sm text-muted-foreground mb-1">Content changes:</div>
        <div
          className="p-3 bg-muted rounded max-h-64 overflow-y-auto prose prose-sm diff-content"
          dangerouslySetInnerHTML={{ __html: contentDiff }}
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onReject}>
          Reject
        </Button>
        <Button onClick={onAccept}>Accept Changes</Button>
      </div>
    </Card>
  );
}
