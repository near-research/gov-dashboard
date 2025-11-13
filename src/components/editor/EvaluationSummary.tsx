import React from "react";
import type { Evaluation } from "@/types/evaluation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/utils/tailwind";

export function EvaluationSummary({ evaluation }: { evaluation: Evaluation }) {
  const isPassing = evaluation.overallPass;

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
    </Alert>
  );
}
