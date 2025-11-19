import { useState } from "react";
import type { Evaluation } from "@/types/evaluation";
import type { VerificationMetadata } from "@/types/agui-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    label: "Relevant",
    description: "Proposal directly relates to the NEAR ecosystem.",
  },
  {
    key: "material",
    label: "Material",
    description: "Proposal has high potential impact and/or risks.",
  },
];

export function ScreeningBadge({
  screening,
  verification,
  verificationId,
}: ScreeningBadgeProps) {
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(
    new Set()
  );
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

  const getAttentionSummaryTone = () => {
    if (screening.attentionScore >= 0.66) {
      return {
        card: "bg-[#5CEFBB] border border-[#5CEFBB] text-black",
        label: "text-black",
        value: "text-black",
      };
    }
    if (screening.attentionScore >= 0.33) {
      return {
        card: "bg-[#6BE7E2] border border-[#6BE7E2]",
        label: "text-black",
        value: "text-black",
      };
    }
    return {
      card: "bg-[#FFBEB5] border border-[#FFBEB5]",
      label: "text-black",
      value: "text-black",
    };
  };

  const attentionSummaryTone = getAttentionSummaryTone();

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
                className={
                  screening.qualityScore >= 0.66
                    ? "bg-[#5CEFBB] border border-[#5CEFBB] text-black"
                    : screening.qualityScore >= 0.33
                    ? "bg-[#FFEAC2] border border-[#FFEAC2] text-black"
                    : "bg-[#FFBEB5] border border-[#FFBEB5] text-black"
                }
              >
                <CardContent className="pt-6 space-y-2">
                  <div className="text-sm font-semibold tracking-wide text-black uppercase">
                    Quality
                  </div>
                  <div className="text-3xl font-extrabold text-black">
                    {formatScore(screening.qualityScore)}
                  </div>
                </CardContent>
              </Card>

              <Card className={attentionSummaryTone.card}>
                <CardContent className="pt-6 space-y-2">
                  <div className="text-sm font-semibold tracking-wide text-black uppercase">
                    Attention
                  </div>
                  <div className="text-3xl font-extrabold text-black">
                    {formatScore(screening.attentionScore)}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quality Criteria */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-black uppercase tracking-wide">
                  Quality Criteria
                </h4>
                <span className="text-sm text-black">
                  {qualityPassed} / {QUALITY_CRITERIA.length}
                </span>
              </div>
              <div className="space-y-2">
                {QUALITY_CRITERIA.map((criterion) => {
                  const result = getCriterionResult(criterion.key, "quality");
                  if (!result) return null;

                  const qualityColor = result.pass
                    ? "bg-[#5CEFBB] border border-[#5CEFBB] text-black transition-colors hover:bg-[#2EEDAA]"
                    : "bg-[#FFBEB5] border border-[#FFBEB5] transition-colors hover:bg-[#FF988A]";
                  const triggerHover = result.pass
                    ? "hover:bg-[#2eedaa]"
                    : "hover:bg-[#FF988A]";
                  const detailTextColor = result.pass
                    ? "text-black"
                    : "text-black";

                  return (
                    <Collapsible
                      key={criterion.key}
                      open={expandedCriteria.has(criterion.key)}
                      onOpenChange={(open) => {
                        setExpandedCriteria((prev) => {
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
                      <Card className={`${qualityColor} h-full`}>
                        <CollapsibleTrigger asChild>
                          <div className="group w-full cursor-pointer">
                            <div
                              className={`flex items-center justify-between p-3 transition-colors rounded-lg ${triggerHover}`}
                            >
                              <div className="flex items-center gap-2 font-medium text-sm text-black">
                                {criterion.label}
                                <Tooltip>
                                  <TooltipTrigger
                                    asChild
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center"
                                    >
                                      <Info className="h-3.5 w-3.5 text-black/60 hover:text-black transition-colors" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs text-sm"
                                  >
                                    <p>{criterion.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    result.pass ? "success" : "destructive"
                                  }
                                  className="pointer-events-none"
                                >
                                  {result.pass ? "PASS" : "FAIL"}
                                </Badge>
                                <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                              </div>
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div
                            className={`px-3 pb-3 ${detailTextColor}`}
                          >
                            <Markdown
                              content={result.reason || "No details provided."}
                              className="text-sm"
                            />
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            </div>

            {/* Attention Scores */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-black uppercase tracking-wide">
                  Attention Scores
                </h4>
                <span className="text-sm text-black">
                  {attentionPoints} / 4
                </span>
              </div>
              <div className="space-y-2">
                {ATTENTION_CRITERIA.map((criterion) => {
                  const result = getCriterionResult(criterion.key, "attention");
                  if (!result) return null;

                  // Type Guard
                  const attentionResult = result as {
                    pass: boolean;
                    reason: string;
                    attentionScore: "high" | "medium" | "low";
                  };

                  const scoreColor =
                    attentionResult.attentionScore === "high"
                      ? "bg-[#5CEFBB] border border-[#5CEFBB] text-black transition-colors hover:bg-[#2EEDAA]"
                      : attentionResult.attentionScore === "medium"
                      ? "bg-[#6BE7E2] border border-[#6BE7E2] text-black transition-colors hover:bg-[#3EDFD9]"
                      : "bg-[#FFBEB5] border border-[#FFBEB5] transition-colors hover:bg-[#FF988A]";
                  const triggerHover =
                    attentionResult.attentionScore === "high"
                      ? "hover:bg-[#2eedaa]"
                      : attentionResult.attentionScore === "medium"
                      ? "hover:bg-[#3EDFD9]"
                      : "hover:bg-[#FF988A]";
                  const detailTextColor =
                    attentionResult.attentionScore === "high"
                      ? "text-black"
                      : attentionResult.attentionScore === "medium"
                      ? "text-black"
                      : "text-black";

                  return (
                    <Collapsible
                      key={criterion.key}
                      open={expandedCriteria.has(criterion.key)}
                      onOpenChange={(open) => {
                        setExpandedCriteria((prev) => {
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
                      <Card className={`${scoreColor} h-full`}>
                        <CollapsibleTrigger asChild>
                          <div className="group w-full cursor-pointer">
                            <div
                              className={`flex items-center justify-between p-3 rounded-lg transition-colors ${triggerHover}`}
                            >
                              <div className="flex items-center gap-2 font-medium text-sm text-black">
                                {criterion.label}
                                <Tooltip>
                                  <TooltipTrigger
                                    asChild
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center"
                                    >
                                      <Info className="h-3.5 w-3.5 text-black/60 hover:text-black transition-colors" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    className="max-w-xs text-sm"
                                  >
                                    <p>{criterion.description}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    attentionResult.attentionScore === "high"
                                      ? "success"
                                      : attentionResult.attentionScore ===
                                        "medium"
                                      ? "secondary"
                                      : "destructive"
                                  }
                                  className={`pointer-events-none ${
                                    attentionResult.attentionScore === "medium"
                                      ? "bg-[#008F8A] text-white border-transparent"
                                      : ""
                                  }`}
                                >
                                  {attentionResult.attentionScore?.toUpperCase()}
                                </Badge>
                                <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                              </div>
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div
                            className={`px-3 pb-3 ${detailTextColor}`}
                          >
                            <Markdown
                              content={attentionResult.reason || "No details provided."}
                              className="text-sm"
                            />
                          </div>
                        </CollapsibleContent>
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
