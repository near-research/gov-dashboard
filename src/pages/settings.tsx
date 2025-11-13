import { useState } from "react";
import Head from "next/head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import prompts from "@/lib/prompts";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  ProposalDetailResponse,
  ProposalReply,
  ProposalRevision,
} from "@/types/proposals";
import type { DiscourseRevisionResponse } from "@/types/discourse";

const stripHtml = (html: string) => {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const buildDiscussionTranscript = (
  proposal: ProposalDetailResponse,
  replies: ProposalReply[]
): string => {
  const original =
    proposal.contentWithoutFrontmatter || proposal.content || "";
  const originalSection = original
    ? `ORIGINAL PROPOSAL (by @${proposal.username || "author"}):\n\n${original.trim()}`
    : "";

  const repliesSection =
    replies.length > 0
      ? replies
          .slice(0, 100)
          .map((reply, index) => {
            const likeCount = reply.like_count ?? 0;
            const likeNote = likeCount > 0 ? ` (${likeCount} likes)` : "";
            const replyToNote = reply.reply_to_post_number
              ? ` [replying to #${reply.reply_to_post_number}]`
              : "";
            const body = stripHtml(reply.cooked || "");
            return `Reply ${index + 1} (Post #${reply.post_number}) by @${
              reply.username
            }${likeNote}${replyToNote}:\n${body}`;
          })
          .join("\n\n---\n\n")
      : "No community replies yet.";

  const sections = [originalSection, `COMMUNITY REPLIES:\n\n${repliesSection}`]
    .filter(Boolean)
    .join("\n\n---\n\n");

  return sections.trim();
};

const formatRevisionTimeline = (
  proposal: ProposalDetailResponse,
  revisions: ProposalRevision[]
): string => {
  const lines: string[] = [];
  const formatDate = (value?: string) => {
    if (!value) return "Unknown date";
    return new Date(value).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (proposal.created_at) {
    lines.push(
      `v1 • ${formatDate(proposal.created_at)} • @${
        proposal.username || "author"
      } (original post)`
    );
  }

  if (Array.isArray(revisions) && revisions.length > 0) {
    const sorted = [...revisions].sort(
      (a, b) => Number(a.version ?? 0) - Number(b.version ?? 0)
    );
    sorted.forEach((revision) => {
      const version = revision.version ?? "?";
      const author = revision.username || "unknown";
      const timestamp = formatDate(revision.created_at);
      const reason = revision.edit_reason ? ` — ${revision.edit_reason}` : "";
      lines.push(`v${version} • ${timestamp} • @${author}${reason}`);
    });
  } else {
    lines.push("No additional revisions found.");
  }

  return lines.join("\n");
};

export default function SettingsPage() {
  const promptOptions = [
    { label: "Custom", key: "custom" },
    { label: "Screen Proposal", key: "screenProposal" },
    { label: "Summarize Proposal", key: "summarizeProposal" },
    { label: "Summarize Revisions", key: "summarizeRevisions" },
    { label: "Summarize Discussion", key: "summarizeDiscussion" },
    { label: "Summarize Reply", key: "summarizeReply" },
  ];
  const modelOptions = [
    { label: "DeepSeek V3.1", value: "deepseek-ai/DeepSeek-V3.1" },
    { label: "OpenAI GPT OSS 120B", value: "openai/gpt-oss-120b" },
    {
      label: "Qwen3 30B A3B Instruct",
      value: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    },
  ];

  const [selectedPrompt, setSelectedPrompt] = useState<string>("custom");
  const [selectedModel, setSelectedModel] = useState<string>(
    modelOptions[0]?.value || ""
  );
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPromptText, setCustomPromptText] = useState("");
  const [proposalIdToLoad, setProposalIdToLoad] = useState("41688");
  const [replyPostNumberToLoad, setReplyPostNumberToLoad] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [showLoadCard, setShowLoadCard] = useState(false);

  const selectedPromptConfig = prompts[selectedPrompt];
  const customContextFields = [
    {
      name: "title",
      label: "Title",
      placeholder: "Proposal Name",
    },
    {
      name: "content",
      label: "Content",
      placeholder: "Text in Markdown Format",
      rows: 12,
    },
  ];
  const extractTemplateVariables = (template: string) => {
    const regex = /{{\s*([\w.-]+)\s*}}/g;
    const matches = new Set<string>();
    let match;
    while ((match = regex.exec(template)) !== null) {
      if (match[1]) {
        matches.add(match[1]);
      }
    }
    return Array.from(matches);
  };

  const handleInputChange = (key: string, value: string) => {
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleLoadProposal = async () => {
    if (!proposalIdToLoad.trim()) {
      setLoadError("Enter a proposal ID");
      return;
    }
    setLoadingProposal(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/proposals/${proposalIdToLoad.trim()}`);
      if (!response.ok) {
        throw new Error("Failed to load proposal");
      }
      const data: ProposalDetailResponse = await response.json();
      if (!data) throw new Error("Proposal not found");

      const replies: ProposalReply[] = Array.isArray(data.replies)
        ? data.replies
        : [];
      const desiredReplyNumber =
        selectedPrompt === "summarizeReply" && replyPostNumberToLoad.trim()
          ? (() => {
              const parsed = Number(replyPostNumberToLoad.trim());
              return Number.isNaN(parsed) ? null : parsed;
            })()
          : null;
      const targetReply: ProposalReply | null =
        selectedPrompt === "summarizeReply"
          ? replies.find((reply) => reply.post_number === desiredReplyNumber) ||
            replies[0] ||
            null
          : null;
      const replyLikeCounts = replies.map((reply) => reply.like_count || 0);
      const totalLikesValue = replyLikeCounts.reduce(
        (sum, count) => sum + count,
        0
      );
      const avgLikesValue =
        replies.length > 0
          ? (totalLikesValue / replies.length).toFixed(1)
          : "0";
      const maxLikesValue =
        replyLikeCounts.length > 0 ? Math.max(...replyLikeCounts) : 0;
      const highlyEngagedValue = replies.filter(
        (reply) => (reply.like_count || 0) > 5
      ).length;
      const discussionTranscript = buildDiscussionTranscript(data, replies);

      let revisionTimelineText = "";
      const needsTimelineField = (
        selectedPrompt === "custom"
          ? customContextFields
          : selectedPromptConfig?.fields || []
      ).some((field) => field.name === "timeline");

      if (needsTimelineField) {
        try {
          const revisionsResponse = await fetch(
            `/api/proposals/${proposalIdToLoad.trim()}/revisions`
          );
          if (revisionsResponse.ok) {
            const revisionsData: DiscourseRevisionResponse =
              await revisionsResponse.json();
            revisionTimelineText = formatRevisionTimeline(
              data,
              revisionsData.revisions || []
            );
            if (revisionsData.current_version) {
              data.version = revisionsData.current_version;
            }
          } else {
            console.warn(
              "Failed to fetch revisions for timeline:",
              revisionsResponse.status
            );
          }
        } catch (timelineError) {
          console.error("Timeline fetch error:", timelineError);
        }
      }

      const updatedFields: Record<string, string> = {};
      const targetFields =
        selectedPrompt === "custom"
          ? customContextFields
          : selectedPromptConfig?.fields || [];

      targetFields.forEach((field) => {
        switch (field.name) {
          case "title":
            updatedFields[field.name] =
              data.title || data.metadata?.title || "";
            break;
          case "content":
            updatedFields[field.name] =
              selectedPrompt === "summarizeReply" && targetReply
                ? stripHtml(targetReply.cooked || "")
                : data.contentWithoutFrontmatter || data.content || "";
            break;
          case "currentVersion":
            updatedFields[field.name] = String(data.version ?? "");
            break;
          case "author":
            updatedFields[field.name] =
              selectedPrompt === "summarizeReply" && targetReply
                ? targetReply.username || ""
                : data.username || "";
            break;
          case "categoryId":
            updatedFields[field.name] = String(data.category_id ?? "");
            break;
          case "postId":
            updatedFields[field.name] = String(data.topic_id ?? "");
            break;
          case "postNumber":
            updatedFields[field.name] =
              targetReply && typeof targetReply.post_number === "number"
                ? String(targetReply.post_number)
                : updatedFields[field.name] || "";
            break;
          case "replyTo":
            updatedFields[field.name] = targetReply?.reply_to_post_number
              ? String(targetReply.reply_to_post_number)
              : "";
            break;
          case "replyToUser":
            updatedFields[field.name] =
              targetReply?.reply_to_user?.username || "";
            break;
          case "likes":
            updatedFields[field.name] = targetReply
              ? String(targetReply.like_count ?? 0)
              : "";
            break;
          case "totalLikes":
            updatedFields[field.name] = String(totalLikesValue);
            break;
          case "avgLikes":
            updatedFields[field.name] = String(avgLikesValue);
            break;
          case "maxLikes":
            updatedFields[field.name] = String(maxLikesValue);
            break;
          case "highlyEngaged":
            updatedFields[field.name] = String(highlyEngagedValue);
            break;
          case "discussion":
            updatedFields[field.name] = discussionTranscript;
            break;
          case "timeline":
            updatedFields[field.name] = revisionTimelineText;
            break;
          default:
            break;
        }
      });

      if (Object.keys(updatedFields).length > 0) {
        setInputValues((prev) => ({ ...prev, ...updatedFields }));
      } else {
        setLoadError("No matching fields to load from proposal");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unable to fetch proposal";
      setLoadError(message);
    } finally {
      setLoadingProposal(false);
    }
  };

  const buildCustomPromptPayload = () => {
    const replaceTemplate = (template: string) =>
      template.replace(
        /{{\s*([\w.-]+)\s*}}/g,
        (_, key) => inputValues[key]?.trim() ?? `{{${key}}}`
      );
    const sections: string[] = [];
    if (inputValues.title?.trim()) {
      sections.push(`Proposal Title:\n${inputValues.title.trim()}`);
    }
    if (inputValues.content?.trim()) {
      sections.push(`Proposal Content:\n${inputValues.content.trim()}`);
    }
    if (customPromptText.trim()) {
      sections.push(
        `Instructions:\n${replaceTemplate(customPromptText.trim())}`
      );
    }
    return sections.join("\n\n").trim();
  };

  const reservedFieldNames = new Set(
    customContextFields.map((field) => field.name)
  );
  const customVariableNames = extractTemplateVariables(customPromptText).filter(
    (name) => !reservedFieldNames.has(name)
  );

  const renderLoadSection = () => (
    <div className="space-y-4">
      <Separator />
      <div className="flex items-center justify-between">
        <CardTitle>Proposal</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-xs font-semibold"
          onClick={() => setShowLoadCard((prev) => !prev)}
        >
          {showLoadCard ? (
            <>
              Autofill <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              Autofill <ChevronDown className="h-3 w-3" />
            </>
          )}
        </Button>
      </div>
      {showLoadCard && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={proposalIdToLoad}
              onChange={(e) => setProposalIdToLoad(e.target.value)}
              placeholder="Forum Topic ID"
            />
            <Button
              variant="outline"
              type="button"
              onClick={handleLoadProposal}
              disabled={loadingProposal}
            >
              {loadingProposal ? "Loading..." : "Load"}
            </Button>
          </div>
          {selectedPrompt === "summarizeReply" && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Post Number
              </label>
              <Input
                value={replyPostNumberToLoad}
                onChange={(e) => setReplyPostNumberToLoad(e.target.value)}
                placeholder="e.g. 5"
              />
              <p className="text-xs text-muted-foreground">
                Choose which reply to summarize (leave blank for the first
                reply).
              </p>
            </div>
          )}
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        </div>
      )}
    </div>
  );

  const runPrompt = async () => {
    if (selectedPrompt !== "custom" && !selectedPromptConfig) return;
    setLoading(true);
    setError(null);
    setResult("");

    try {
      const prompt =
        selectedPrompt === "custom"
          ? buildCustomPromptPayload()
          : selectedPromptConfig.buildPrompt(inputValues);

      if (!prompt) {
        throw new Error("Please provide prompt input before running.");
      }
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel || "deepseek-ai/DeepSeek-V3.1",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to run prompt");
      }

      const data = await response.json();
      setResult(data.choices?.[0]?.message?.content || "No response");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unexpected error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Lab</title>
      </Head>
      <main className="min-h-screen bg-background py-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">Laboratory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Select Prompt
                </label>
                <Select
                  value={selectedPrompt}
                  onValueChange={(value) => {
                    setSelectedPrompt(value);
                    setInputValues({});
                    setResult("");
                    setError(null);
                    if (value !== "custom") {
                      setCustomPromptText("");
                    }
                    setProposalIdToLoad("41688");
                    setReplyPostNumberToLoad("");
                    setLoadError(null);
                    setShowLoadCard(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    {promptOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Choose Model
                </label>
                <Select
                  value={selectedModel}
                  onValueChange={(value) => setSelectedModel(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPrompt === "custom" ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-2">
                      Write your prompt here:
                    </label>
                    <Textarea
                      value={customPromptText}
                      onChange={(e) => setCustomPromptText(e.target.value)}
                      placeholder="Enter the exact prompt to send to the model"
                      rows={8}
                    />
                  </div>
                  {customVariableNames.length > 0 && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-muted-foreground">
                        Custom Variables
                      </label>
                      <div className="space-y-3">
                        {customVariableNames.map((variable) => (
                          <div key={variable}>
                            <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                              {variable}
                            </label>
                            <Input
                              value={inputValues[variable] || ""}
                              onChange={(e) =>
                                handleInputChange(variable, e.target.value)
                              }
                              placeholder={`Value for ${variable}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    {renderLoadSection()}
                    {customContextFields.map((field) => (
                      <div key={field.name}>
                        <label className="block text-sm font-medium text-muted-foreground mb-2">
                          {field.label}
                        </label>
                        <Textarea
                          value={inputValues[field.name] || ""}
                          onChange={(e) =>
                            handleInputChange(field.name, e.target.value)
                          }
                          placeholder={field.placeholder}
                          rows={field.rows || 4}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {renderLoadSection()}
                  {selectedPromptConfig?.fields?.map((field) => (
                    <div key={field.name}>
                      <label className="block text-sm font-medium text-muted-foreground mb-2">
                        {field.label}
                      </label>
                      <Textarea
                        value={inputValues[field.name] || ""}
                        onChange={(e) =>
                          handleInputChange(field.name, e.target.value)
                        }
                        placeholder={field.placeholder}
                        rows={field.rows || 4}
                      />
                    </div>
                  ))}
                </>
              )}

              <div className="flex justify-end gap-2">
                <Button onClick={runPrompt} disabled={loading}>
                  {loading ? "Running..." : "Run Prompt"}
                </Button>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {result && (
                <Alert>
                  <AlertDescription>
                    <pre className="whitespace-pre-wrap text-sm">{result}</pre>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
