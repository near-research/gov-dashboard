import React from "react";
import type { MessageRole } from "@/types/agui-events";
import type { Evaluation } from "@/types/evaluation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, Wrench, ShieldCheck, ShieldAlert, Check, X } from "lucide-react";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  remoteId?: string;
  evaluation?: Evaluation;
  messageType?: "text" | "evaluation";
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "in_progress" | "completed";
}

type CriteriaItem = {
  label: string;
  pass: boolean;
  reason: string;
};

function CriteriaList({ criteria }: { criteria: CriteriaItem[] }) {
  return (
    <div className="space-y-2 text-sm">
      {criteria.map((item) => (
        <div key={item.label} className="flex gap-2 items-start">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[0.65rem] ${
              item.pass
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-yellow-400 bg-yellow-50 text-yellow-700"
            }`}
          >
            {item.pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          </span>
          <div>
            <div className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
            <p className="text-xs text-foreground/80">{item.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EvaluationMessageCard({ evaluation }: { evaluation: Evaluation }) {
  const isPassing = evaluation.overallPass;
  const qualityScore = Number.isFinite(evaluation.qualityScore)
    ? evaluation.qualityScore.toFixed(1)
    : String(evaluation.qualityScore);
  const attentionScore = Number.isFinite(evaluation.attentionScore)
    ? evaluation.attentionScore.toFixed(1)
    : String(evaluation.attentionScore);

  const criteria: CriteriaItem[] = [
    { label: "Complete", pass: evaluation.complete.pass, reason: evaluation.complete.reason },
    { label: "Legible", pass: evaluation.legible.pass, reason: evaluation.legible.reason },
    { label: "Consistent", pass: evaluation.consistent.pass, reason: evaluation.consistent.reason },
    { label: "Compliant", pass: evaluation.compliant.pass, reason: evaluation.compliant.reason },
    { label: "Justified", pass: evaluation.justified.pass, reason: evaluation.justified.reason },
    { label: "Measurable", pass: evaluation.measurable.pass, reason: evaluation.measurable.reason },
    {
      label: "Relevant",
      pass: evaluation.relevant.score === "high",
      reason: evaluation.relevant.reason,
    },
    {
      label: "Material",
      pass: evaluation.material.score === "high",
      reason: evaluation.material.reason,
    },
  ];

  const issues = criteria.filter((item) => !item.pass);

  return (
    <Card
      className={`border ${
        isPassing ? "bg-emerald-50 border-emerald-200" : "bg-yellow-50 border-yellow-200"
      }`}
    >
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {isPassing ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-yellow-800" />
            )}
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                Screening result
              </div>
              <div className="text-sm font-semibold">
                {isPassing ? "Passes screening" : "Needs work"}
              </div>
            </div>
          </div>
          <Badge variant={isPassing ? "outline" : "secondary"} className="text-xs">
            {isPassing ? "Pass" : "Fail"}
          </Badge>
        </div>

        <p className="text-sm leading-relaxed text-foreground/90">
          {evaluation.summary || "No summary provided."}
        </p>

        <div className="flex gap-3 text-[0.7rem] text-foreground/70">
          <div>Quality {qualityScore}</div>
          <div>Attention {attentionScore}</div>
        </div>

        {isPassing ? (
          <details className="mt-2 rounded border border-foreground/10 bg-white/40 p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-foreground/80">
              View criteria details
            </summary>
            <div className="mt-2">
              <CriteriaList criteria={criteria} />
            </div>
          </details>
        ) : (
          <div className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60 mb-2">
              Issues to address
            </div>
            <CriteriaList criteria={issues.length ? issues : criteria} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MessageCard({ msg }: { msg: Message }) {
  if (msg.evaluation) {
    return <EvaluationMessageCard evaluation={msg.evaluation} />;
  }
  return (
    <Card className={msg.role === "user" ? "bg-blue-50 border-blue-200" : ""}>
      <CardContent className="pt-3 pb-3">
        <div className="text-xs font-semibold text-muted-foreground mb-2">
          {msg.role === "user" ? "You" : "Assistant"}
        </div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {msg.content}
        </div>
      </CardContent>
    </Card>
  );
}
export function SidebarChat({
  currentStep,
  messages,
  currentMessage,
  activeToolCalls,
  isRunning,
  suggestions,
  inputMessage,
  setInputMessage,
  sendMessage,
  evaluationSlot,
  onEvaluate,
  evalLoading,
  evaluationError,
  isPassing,
}: {
  currentStep: string | null;
  messages: Message[];
  currentMessage: {
    id: string;
    content: string;
    remoteId?: string;
  } | null;
  activeToolCalls: Map<string, ToolCallState>;
  isRunning: boolean;
  suggestions: string[];
  inputMessage: string;
  setInputMessage: (s: string) => void;
  sendMessage: (s: string) => void;
  evaluationSlot?: React.ReactNode;
  onEvaluate?: () => void;
  evalLoading?: boolean;
  evaluationError?: string;
  isPassing?: boolean;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 pb-4 border-b">
        <h2 className="text-lg font-semibold mb-1">Proposal Assistant</h2>
        <p className="text-sm text-muted-foreground">
          Screen proposals and suggest improvements
        </p>

        {typeof isPassing === "boolean" && (
          <Badge
            variant={isPassing ? "outline" : "destructive"}
            className="text-xs mt-2"
          >
            {isPassing ? "Passing" : "Needs work"}
          </Badge>
        )}

        {evaluationError && (
          <Alert className="mt-3 border-red-200 bg-red-50 text-red-900">
            <AlertDescription>{evaluationError}</AlertDescription>
          </Alert>
        )}

        {currentStep && (
          <Badge variant="secondary" className="mt-3 gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            {currentStep}
          </Badge>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 pr-2 mb-4">
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div>
              <Button
                onClick={onEvaluate}
                disabled={isRunning || !!evalLoading || !onEvaluate}
                variant="outline"
                className="mb-3 flex items-center justify-center gap-2"
              >
                <ShieldCheck className="h-4 w-4" />
                Screen this proposal
              </Button>
              <p className="mb-3 font-semibold text-sm">Try a quick action:</p>
              <div className="space-y-2">
                {suggestions.map((suggestion, i) => (
                  <Button
                    key={i}
                    onClick={() => sendMessage(suggestion)}
                    disabled={isRunning}
                    variant="outline"
                    className="w-full justify-start text-left h-auto py-3 whitespace-normal"
                    size="sm"
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageCard key={msg.id} msg={msg} />
              ))}

              {currentMessage && (
                <Card>
                  <CardContent className="pt-3 pb-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      Assistant
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                      {currentMessage.content}
                    </div>
                  </CardContent>
                </Card>
              )}

              {Array.from(activeToolCalls.values()).map((tc) => (
                <Card key={tc.id} className="bg-orange-50 border-orange-200">
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="h-3 w-3 text-orange-600" />
                      <div className="text-xs font-semibold text-orange-900">
                        Tool Call
                      </div>
                    </div>
                    <div className="font-mono text-xs text-orange-800 mb-2">
                      {tc.name}({tc.args.substring(0, 50)}
                      {tc.args.length > 50 ? "…" : ""})
                    </div>
                    <Badge
                      variant={
                        tc.status === "completed" ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {tc.status === "in_progress"
                        ? "⏳ In progress"
                        : "✓ Completed"}
                    </Badge>
                  </CardContent>
                </Card>
              ))}

              {isRunning && !currentMessage && activeToolCalls.size === 0 && (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-testid="typing-indicator"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {evalLoading ? "Evaluating…" : "Thinking…"}
                </div>
              )}
            </>
          )}

          {evaluationSlot}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex gap-2 pt-4 border-t">
        <Input
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage(inputMessage);
            }
          }}
          placeholder="Ask me to screen or improve…"
          disabled={isRunning}
          className="text-sm"
        />
        <Button
          onClick={() => sendMessage(inputMessage)}
          disabled={isRunning || !inputMessage.trim()}
          size="icon"
        >
          {isRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
