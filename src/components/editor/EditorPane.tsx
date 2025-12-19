"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Image as ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/components/proposal/Markdown";
import { diffPartialText } from "@/utils/ui/diff";

type EditorPaneProps = {
  title: string;
  content: string;
  pendingTitle?: string;
  pendingContent?: string;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
  disabled: boolean;
  viewMode: "editor" | "preview";
  onToggleView: (mode: "editor" | "preview") => void;
  showDiffHighlights: boolean;
  diffHtml?: string;
  hasPendingChanges?: boolean;
  onAcceptChanges?: () => void;
  onRejectChanges?: () => void;
};

export function EditorPane({
  title,
  content,
  pendingTitle,
  pendingContent,
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
}: EditorPaneProps) {
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const handleViewChange = (value: string) => {
    if (value === "editor" || value === "preview") {
      onToggleView(value);
    }
  };

  const effectivePendingTitle = pendingTitle ?? title;
  const effectivePendingContent = pendingContent ?? content;
  const titleDiffHtml =
    hasPendingChanges && (title || effectivePendingTitle)
      ? diffPartialText(title, effectivePendingTitle)
      : null;
  const contentDiffHtml =
    hasPendingChanges && (content || effectivePendingContent)
      ? diffPartialText(content, effectivePendingContent)
      : null;

  const insertImage = () => {
    if (!imageUrl.trim()) return;
    const alt = imageAlt.trim() || "image";
    const snippet = `![${alt}](${imageUrl.trim()})`;
    setContent(content ? `${content}\n\n${snippet}` : snippet);
    setShowImageDialog(false);
    setImageUrl("");
    setImageAlt("");
  };

  const onCopyTitle = () => navigator.clipboard.writeText(title || "");
  const onCopyContent = () => navigator.clipboard.writeText(content || "");

  const showPendingControls =
    Boolean(hasPendingChanges) && onAcceptChanges && onRejectChanges;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-0 py-2">
        <div className="flex flex-col gap-1">
          <Tabs value={viewMode} onValueChange={handleViewChange}>
            <TabsList className="bg-transparent p-0">
              <TabsTrigger
                value="editor"
                className="px-3 py-1 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Editor
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="px-3 py-1 cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {showPendingControls && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={onRejectChanges}
            >
              Reject
            </Button>
            <Button
              size="sm"
              className="gap-1 bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-500"
              onClick={onAcceptChanges}
            >
              Accept
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {viewMode === "editor" ? (
          <div className="flex flex-1 overflow-auto">
            <div className="space-y-6 p-4 w-full">
              <div className="space-y-2">
                {hasPendingChanges && titleDiffHtml ? (
                  <div
                    className="text-2xl font-bold diff-content"
                    dangerouslySetInnerHTML={{ __html: titleDiffHtml }}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor="proposal-title"
                        className="text-sm font-medium"
                      >
                        Title
                      </Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        onClick={onCopyTitle}
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
                )}
              </div>

              <div className="space-y-2">
                {hasPendingChanges && contentDiffHtml ? (
                  <div
                    className="prose diff-content max-w-none"
                    dangerouslySetInnerHTML={{ __html: contentDiffHtml }}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <Label
                        htmlFor="proposal-content"
                        className="text-sm font-medium"
                      >
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
                          onClick={onCopyContent}
                        >
                          <Copy className="h-4 w-4" aria-hidden />
                          Copy
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      id="proposal-content"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      disabled={disabled}
                      placeholder="Write your proposal content in Markdown format. Include objectives, KPIs, timeline, and budget details."
                      rows={15}
                      className="font-mono text-sm resize-none h-72"
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-2 overflow-auto p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold truncate">
                {title || "Untitled title"}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={onCopyContent}
              >
                <Copy className="h-4 w-4" aria-hidden />
                Copy
              </Button>
            </div>
            {hasPendingChanges && contentDiffHtml ? (
              <div
                className="prose diff-content max-w-none"
                dangerouslySetInnerHTML={{ __html: contentDiffHtml }}
              />
            ) : showDiffHighlights && diffHtml ? (
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
      </div>

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
