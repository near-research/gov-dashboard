import React from "react";
import type { MessageRole, VerificationMetadata } from "@/types/agui-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, Wrench } from "lucide-react";
import { VerificationProof } from "@/components/verification/VerificationProof";
import type { RemoteProof } from "@/types/verification";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  verification?: VerificationMetadata;
  remoteProof?: RemoteProof | null;
  remoteId?: string;
  model?: string;
}

interface ToolCallState {
  id: string;
  name: string;
  args: string;
  status: "in_progress" | "completed";
  verification?: VerificationMetadata;
  model?: string;
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
}: {
  currentStep: string | null;
  messages: Message[];
  currentMessage: {
    id: string;
    content: string;
    verification?: VerificationMetadata;
    remoteProof?: RemoteProof | null;
    remoteId?: string;
    model?: string;
  } | null;
  activeToolCalls: Map<string, ToolCallState>;
  isRunning: boolean;
  suggestions: string[];
  inputMessage: string;
  setInputMessage: (s: string) => void;
  sendMessage: (s: string) => void;
  evaluationSlot?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 pb-4 border-b">
        <h2 className="text-lg font-semibold mb-1">Proposal Assistant</h2>
        <p className="text-sm text-muted-foreground">
          Screen proposals and suggest improvements
        </p>

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
                <Card
                  key={msg.id}
                  className={
                    msg.role === "user" ? "bg-blue-50 border-blue-200" : ""
                  }
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      {msg.role === "user" ? "You" : "Assistant"}
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
                      {msg.content}
                    </div>
                    {msg.role === "assistant" && (
                      <VerificationProof
                        verification={msg.verification}
                        verificationId={msg.remoteId}
                        prefetchedProof={msg.remoteProof}
                        model={msg.model ?? undefined}
                        className="mt-3"
                      />
                    )}
                  </CardContent>
                </Card>
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
                  <VerificationProof
                    verification={currentMessage.verification}
                    prefetchedProof={currentMessage.remoteProof}
                    verificationId={currentMessage.remoteId}
                    model={currentMessage.model ?? undefined}
                    className="mt-3"
                  />
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
                    <VerificationProof
                      verification={tc.verification}
                      model={tc.model ?? undefined}
                      className="mt-3"
                    />
                  </CardContent>
                </Card>
              ))}

      {isRunning && !currentMessage && activeToolCalls.size === 0 && (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="typing-indicator"
        >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
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
