import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, CheckCircle2, XCircle, Info } from "lucide-react";
import { VerificationProof } from "@/components/verification/VerificationProof";
import { Markdown } from "@/components/proposal/Markdown";

interface ScreeningBadgeProps {
  screening: {
    evaluation: Evaluation;
    title: string;
    nearAccount: string;
    timestamp: string;
    revisionNumber: number;
    qualityScore: number;
    attentionScore: number;
  };
  verification?: VerificationMetadata;
  verificationId?: string;
}

const QUALITY_CRITERIA = [
  {
    key: "complete",
    label: "Complete",
    description:
      "Proposal includes all the required template elements for a proposal of its type. For example, funding proposal includes budget and milestones.",
  },
  {
    key: "legible",
    label: "Legible",
    description:
      "Proposal content is clear enough that the decision being made can be unambiguously understood.",
  },
  {
    key: "consistent",
    label: "Consistent",
    description:
      "Proposal does not contradict itself. Details such as budget, dates, and scope, are consistent everywhere they are referenced in the proposal contents.",
  },
  {
    key: "compliant",
    label: "Compliant",
    description:
      "Proposal is compliant with all relevant rules/guidelines, such as the Constitution, HSP-001, and the Code of Conduct.",
  },
  {
    key: "justified",
    label: "Justified",
    description:
      "Proposal provides rationale that logically supports the stated objectives and actions. For example, the proposed solution reasonably addresses the problem and the proposal explains how.",
  },
  {
    key: "measurable",
    label: "Measurable",
    description:
      "Proposal includes measurable outcomes and success criteria that can be evaluated.",
  },
];

const ATTENTION_CRITERIA = [
  {
    key: "relevant",
    label: "Relevance",
    description: "Proposal directly relates to the NEAR ecosystem.",
  },
  {
    key: "material",
    label: "Impact",
    description: "Proposal has high potential impact and/or risks.",
  },
];

export function ScreeningBadge({
  screening,
  verification,
  verificationId,
}: ScreeningBadgeProps) {
  const [expandedQualityCriteria, setExpandedQualityCriteria] = useState<
    Set<string>
  >(new Set());
  const [expandedAttentionCriteria, setExpandedAttentionCriteria] = useState<
    Set<string>
  >(new Set());
  const [isExpanded, setIsExpanded] = useState(true);

  const formatScore = (score: number) => `${(score * 100).toFixed(0)}%`;

  const getCriterionResult = (key: string, type: "quality" | "attention") => {
    const result = screening.evaluation[key as keyof Evaluation];

    if (type === "attention") {
      const attentionScore = result as {
        score: "high" | "medium" | "low";
        reason: string;
      };
      return {
        pass: attentionScore.score === "high",
        reason: attentionScore.reason,
        attentionScore: attentionScore.score,
      };
    }

    return result as { pass: boolean; reason: string };
  };

  const qualityPassed = QUALITY_CRITERIA.filter((criterion) => {
    const result = getCriterionResult(criterion.key, "quality");
    return result?.pass === true;
  }).length;

  const attentionPoints = ATTENTION_CRITERIA.reduce((sum, criterion) => {
    const result = getCriterionResult(criterion.key, "attention") as {
      attentionScore: "high" | "medium" | "low";
    } | null;
    if (!result?.attentionScore) return sum;
    return (
      sum +
      (result.attentionScore === "high"
        ? 2
        : result.attentionScore === "medium"
        ? 1
        : 0)
    );
  }, 0);

  const getScoreTone = (score: number) => {
    if (score >= 0.66) return "bg-emerald-100/80";
    if (score >= 0.33) return "bg-cyan-100/80";
    return "bg-rose-100/80";
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Evaluation</CardTitle>
              {screening.evaluation.overallPass ? (
                <CheckCircle2 className="h-5 w-5 text-[#009E66]" />
              ) : (
                <XCircle className="h-5 w-5 text-[#E4523F]" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition cursor-pointer"
              aria-expanded={isExpanded}
            >
              <ChevronDown
                className={`h-5 w-5 transition-transform duration-200 ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="text-xs">
              {new Date(screening.timestamp).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              • Version {screening.revisionNumber}
            </p>
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="space-y-4">
            {/* Score Summary */}
            <div className="grid grid-cols-2 gap-4">
              <Card
                className={`border-none shadow-sm rounded-2xl ${getScoreTone(
                  screening.qualityScore
                )}`}
              >
                <CardContent className="px-4 py-3 space-y-1">
                  <div className="text-xs font-semibold tracking-wide text-black uppercase">
                    Ready
                  </div>
                  <div className="text-2xl font-semibold text-black">
                    {formatScore(screening.qualityScore)}
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`border-none shadow-sm rounded-2xl ${getScoreTone(
                  screening.attentionScore
                )}`}
              >
                <CardContent className="px-4 py-3 space-y-1">
                  <div className="text-xs font-semibold tracking-wide text-black uppercase">
                    Aligned
                  </div>
                  <div className="text-2xl font-semibold text-black">
                    {formatScore(screening.attentionScore)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quality Criteria */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-black uppercase tracking-wide">
                  Criteria
                </h4>
                <span className="text-sm text-black">
                  {qualityPassed} / {QUALITY_CRITERIA.length}
                </span>
              </div>
              <div className="space-y-3">
                {QUALITY_CRITERIA.map((criterion) => {
                  const result = getCriterionResult(criterion.key, "quality");
                  if (!result) return null;

                  const cardTone = result.pass
                    ? "bg-emerald-100/80"
                    : "bg-rose-100/80";

                  const isOpen = expandedQualityCriteria.has(criterion.key);

                  return (
                    <Collapsible
                      key={criterion.key}
                      open={isOpen}
                      onOpenChange={(open) => {
                        setExpandedQualityCriteria((prev) => {
                          const next = new Set(prev);
                          if (open) {
                            next.add(criterion.key);
                          } else {
                            next.delete(criterion.key);
                          }
                          return next;
                        });
                      }}
                    >
                      <Card className={`${cardTone} border-none shadow-sm`}>
                        <CardContent className="px-4 py-2">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 text-sm font-semibold tracking-wide text-black py-1 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span>{criterion.label}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      role="presentation"
                                      className="inline-flex items-center justify-center cursor-help"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Info className="h-3.5 w-3.5 opacity-70" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs text-xs"
                                  >
                                    <p>{criterion.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-2 data-[state=closed]:mt-0 data-[state=closed]:hidden">
                            <div className="text-sm leading-relaxed text-black/80">
                              <Markdown
                                content={
                                  result.reason || "No details provided."
                                }
                                className="prose prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 [&_ul]:ml-0 [&_ol]:ml-0 [&_ul]:!pl-1 [&_ol]:!pl-1"
                              />
                            </div>
                          </CollapsibleContent>
                        </CardContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            </div>

            {/* Alignment Scores */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Alignment
                </h4>
                <span className="text-sm text-muted-foreground">
                  {attentionPoints} / 4
                </span>
              </div>

              <div className="space-y-3">
                {ATTENTION_CRITERIA.map((criterion) => {
                  const result = getCriterionResult(criterion.key, "attention");
                  if (!result) return null;

                  const attentionResult = result as {
                    pass: boolean;
                    reason: string;
                    attentionScore: "high" | "medium" | "low";
                  };

                  const cardTone =
                    attentionResult.attentionScore === "high"
                      ? "bg-emerald-100/80"
                      : attentionResult.attentionScore === "medium"
                      ? "bg-cyan-100/80"
                      : "bg-rose-100/80";
                  const isOpen = expandedAttentionCriteria.has(criterion.key);

                  return (
                    <Collapsible
                      key={criterion.key}
                      open={isOpen}
                      onOpenChange={(open) => {
                        setExpandedAttentionCriteria((prev) => {
                          const next = new Set(prev);
                          if (open) {
                            next.add(criterion.key);
                          } else {
                            next.delete(criterion.key);
                          }
                          return next;
                        });
                      }}
                    >
                      <Card className={`${cardTone} border-none shadow-sm`}>
                        <CardContent className="px-4 py-2">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 text-sm font-semibold tracking-wide text-black py-1 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span>{criterion.label}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      role="presentation"
                                      className="inline-flex items-center justify-center cursor-help"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Info className="h-3.5 w-3.5 opacity-70" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs text-xs"
                                  >
                                    <p>{criterion.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </CollapsibleTrigger>

                          <CollapsibleContent className="mt-2 data-[state=closed]:mt-0 data-[state=closed]:hidden">
                            <div className="text-sm leading-relaxed text-black/80">
                              <Markdown
                                content={
                                  attentionResult.reason ||
                                  "No details provided."
                                }
                                className="prose prose-sm prose-p:my-1 prose-ul:my-1 prose-ol:my-1 [&_ul]:ml-0 [&_ol]:ml-0 [&_ul]:!pl-1 [&_ol]:!pl-1"
                              />
                            </div>
                          </CollapsibleContent>
                        </CardContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            </div>

            {(verification || verificationId) && (
              <VerificationProof
                verification={verification}
                verificationId={verificationId}
                className="mt-4"
              />
            )}
          </CardContent>
        )}
      </Card>
    </TooltipProvider>
  );
}
