import React from "react";
import type { Evaluation } from "@/types/evaluation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/utils/tailwind";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface EvaluationSummaryProps {
  evaluation: Evaluation;
}

export function EvaluationSummary({
  evaluation,
}: EvaluationSummaryProps) {
  const isPassing = evaluation.overallPass;

  const improvementPrompt = (() => {
    const lines: string[] = [];
    const crits: Array<[string, string, boolean]> = [
      ["Complete", evaluation.complete.reason, evaluation.complete.pass],
      ["Legible", evaluation.legible.reason, evaluation.legible.pass],
      ["Consistent", evaluation.consistent.reason, evaluation.consistent.pass],
      ["Compliant", evaluation.compliant.reason, evaluation.compliant.pass],
      ["Justified", evaluation.justified.reason, evaluation.justified.pass],
      ["Measurable", evaluation.measurable.reason, evaluation.measurable.pass],
    ];
    crits.forEach(([label, reason, pass]) => {
      if (!pass && reason) {
        lines.push(`- ${label}: ${reason}`);
      }
    });
    if (evaluation.relevant.score !== "high") {
      lines.push(`- Relevant: ${evaluation.relevant.reason}`);
    }
    if (evaluation.material.score !== "high") {
      lines.push(`- Material: ${evaluation.material.reason}`);
    }
    const summary = evaluation.summary ? `Summary: ${evaluation.summary}` : "";
    const body = lines.length ? lines.join("\n") : "N/A";
    return `Help me revise this proposal so it passes screening.\n${summary}\nFix these issues:\n${body}`;
  })();

  const handleCopyPrompt = () => {
    try {
      navigator.clipboard.writeText(improvementPrompt);
    } catch (e) {
      logger.error("Copy failed:", e);
    }
  };

  return (
    <Alert
      className={cn(
        "mt-3",
        isPassing
          ? "bg-green-50 border-green-200 text-green-900"
          : "bg-yellow-50 border-yellow-200 text-yellow-900"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {isPassing ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
        )}
        <span className="text-sm font-bold">
          {isPassing ? "Passes Screening" : "Needs Work"}
        </span>
      </div>
      <AlertDescription className="text-xs leading-relaxed">
        {evaluation.summary}
      </AlertDescription>
      {!isPassing && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="flex items-center justify-between text-xs font-semibold text-foreground/80">
            <span>Copy prompt to fix issues</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleCopyPrompt}>
              Copy
            </Button>
          </div>
          <pre className="whitespace-pre-wrap text-xs bg-muted rounded-md p-3 border">
            {improvementPrompt}
          </pre>
        </div>
      )}
    </Alert>
  );
}
