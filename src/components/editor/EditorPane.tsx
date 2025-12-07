import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Check, Copy, X, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "@/components/proposal/Markdown";

export function EditorPane({
  title,
  content,
  setTitle,
  setContent,
  disabled,
  viewMode,
  onToggleView,
  showDiffHighlights,
  diffHtml,
  hasPendingChanges,
  onAcceptChanges,
  onRejectChanges,
}: {
  title: string;
  content: string;
  setTitle: (s: string) => void;
  setContent: (s: string) => void;
  disabled: boolean;
  viewMode: "editor" | "preview";
  onToggleView: (mode: "editor" | "preview") => void;
  showDiffHighlights: boolean;
  diffHtml?: string;
  hasPendingChanges?: boolean;
  onAcceptChanges?: () => void;
  onRejectChanges?: () => void;
}) {
  const [showImageDialog, setShowImageDialog] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState("");
  const [imageAlt, setImageAlt] = React.useState("");

  const insertImage = () => {
    if (!imageUrl.trim()) return;
    const alt = imageAlt.trim() || "image";
    const snippet = `![${alt}](${imageUrl.trim()})`;
    setContent(content ? `${content}\n\n${snippet}` : snippet);
    setShowImageDialog(false);
    setImageUrl("");
    setImageAlt("");
  };

  return (
    <div className="space-y-6">
      {/* Diff Controls Banner */}
      {hasPendingChanges && showDiffHighlights && (
        <Alert className="bg-orange-50 border-orange-300">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-orange-900 mb-1">
                  AI Suggested Changes
                </div>
                <div className="text-xs text-orange-800">
                  <span className="text-green-700">Green</span> = additions •{" "}
                  <span className="text-red-700">Red</span> = removals
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={onRejectChanges}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  <X className="h-3 w-3" />
                  Reject
                </Button>
                <Button onClick={onAcceptChanges} size="sm" className="gap-1">
                  <Check className="h-3 w-3" />
                  Accept
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Title Input / Preview */}
      <div className="space-y-2">
        {viewMode === "editor" ? (
          <>
          <div className="flex items-center justify-between gap-2">
              <Label htmlFor="proposal-title" className="text-sm font-medium">
                Title
              </Label>
             <Button
               variant="ghost"
               size="sm"
                className="gap-1"
                onClick={() => navigator.clipboard.writeText(title || "")}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy
              </Button>
            </div>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
              placeholder="Title goes here…"
              className="text-base font-semibold"
            />
          </>
        ) : (
          <div className="text-3xl font-bold text-foreground min-h-[3rem]">
            {title || "Untitled proposal"}
          </div>
        )}
      </div>

      {/* Editor View */}
      {viewMode === "editor" && (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="proposal-content" className="text-sm font-medium">
                Content
              </Label>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setShowImageDialog(true)}
              >
                <ImageIcon className="h-4 w-4" aria-hidden />
                Add image
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => navigator.clipboard.writeText(content || "")}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy
              </Button>
            </div>
          </div>
          {showDiffHighlights && diffHtml ? (
            <div
              className="min-h-[400px] max-h-[640px] overflow-y-auto p-4 border-2 rounded-lg bg-muted font-mono text-sm leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          ) : (
            <Textarea
              id="proposal-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={disabled}
              placeholder="Write your proposal content in Markdown format. Be sure to include any objectives, key performance indicators, a timeline with milestones, and a detailed budget breakdown if necessary."
              rows={24}
              className="font-mono text-sm resize-none"
            />
          )}
        </div>
      )}

      {/* Preview View */}
      {viewMode === "preview" && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => navigator.clipboard.writeText(content || "")}
            >
              <Copy className="h-4 w-4" aria-hidden />
              Copy content
            </Button>
          </div>
          {showDiffHighlights && diffHtml ? (
            <div
              className="prose prose-sm max-w-none border rounded-lg p-4"
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          ) : content ? (
            <div className="prose prose-sm max-w-none">
              <Markdown content={content} />
            </div>
          ) : (
            <div className="h-full w-full rounded-lg border border-dashed border-muted-foreground/30 p-6 text-sm text-muted-foreground italic">
              Add a title and content to see the preview.
            </div>
          )}
        </div>
      )}

      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add image</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Image URL (https://...)"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
            <Input
              placeholder="Alt text (optional)"
              value={imageAlt}
              onChange={(e) => setImageAlt(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowImageDialog(false)}>
                Cancel
              </Button>
              <Button onClick={insertImage} disabled={!imageUrl.trim()}>
                Insert
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
