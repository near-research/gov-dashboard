import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Send, Wrench } from "lucide-react";
import type {
  DiscussionSummaryResponse,
  ProposalRevisionSummaryResponse,
  TextSummaryResponse,
} from "@/types/summaries";
import type { ProposalReply } from "@/types/proposals";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  messageId?: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

type ConversationEntry = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type RawToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

interface ProposalChatbotProps {
  proposalTitle: string;
  proposalContent: string;
  proposalId: string;
  replies: ProposalReply[];
  proposalAuthor: string;
  model?: string;
}

export const ProposalChatbot = ({
  proposalTitle,
  proposalContent,
  proposalId,
  replies = [],
  proposalAuthor,
  model = "deepseek-ai/DeepSeek-V3.1",
}: ProposalChatbotProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationHistoryRef = useRef<ConversationEntry[]>([]);

  // Define available tools
  const tools = [
    {
      type: "function",
      function: {
        name: "summarize_revisions",
        description:
          "Analyzes the complete revision and edit history of THIS proposal. Call this when user asks about: changes, edits, modifications, revisions, updates, what was changed, what changed, edit history, version history, or differences between versions.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "summarize_proposal",
        description:
          "Generates a comprehensive summary of THIS proposal's main content and key points. Call this when user asks for: summary, overview, main points, key details, what is this proposal about, explain this proposal, or breakdown.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "summarize_discussion",
        description:
          "Summarizes all replies, comments, and community discussion for THIS proposal. Call this when user asks about: discussion, replies, comments, what people are saying, community feedback, debate, concerns raised, or opinions.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
  ];

  // Execute tool calls
  const executeToolCall = async (
    toolName: string,
    _args?: Record<string, unknown>
  ): Promise<string> => {
    try {
      switch (toolName) {
        case "summarize_revisions":
          const revResponse = await fetch(
            `/api/proposals/${proposalId}/revisions/summarize`,
            { method: "POST" }
          );
          if (!revResponse.ok)
            throw new Error("Failed to fetch revision summary");
          const revData: ProposalRevisionSummaryResponse =
            await revResponse.json();
          return `Revision Analysis:\n\n${
            revData.summary
          }\n\nTotal Revisions: ${revData.totalRevisions || 0}`;

        case "summarize_proposal":
          const propResponse = await fetch(
            `/api/proposals/${proposalId}/summarize`,
            { method: "POST" }
          );
          if (!propResponse.ok)
            throw new Error("Failed to fetch proposal summary");
          const propData: TextSummaryResponse = await propResponse.json();
          return `Proposal Summary:\n\n${propData.summary}`;

        case "summarize_discussion":
          const discResponse = await fetch(
            `/api/discourse/topics/${proposalId}/summarize`,
            { method: "POST" }
          );
          if (!discResponse.ok)
            throw new Error("Failed to fetch discussion summary");
          const discData: DiscussionSummaryResponse =
            await discResponse.json();
          return `Discussion Summary:\n\n${discData.summary}`;

        default:
          return `Unknown tool: ${toolName}`;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      return `Error executing ${toolName}: ${message}`;
    }
  };

  // Build context
  const buildContext = () => {
    const stripHtml = (html: string) => {
      return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
    };

    let context = `# Proposal: ${proposalTitle}\n\n`;
    context += `Proposal ID: ${proposalId}\n`;
    context += `Author: @${proposalAuthor}\n\n`;
    context += `## Proposal Content:\n${stripHtml(proposalContent)}\n\n`;

    if (replies && replies.length > 0) {
      context += `## Discussion (${replies.length} replies):\n\n`;
      replies.forEach((reply) => {
        context += `Reply #${reply.post_number} by @${reply.username}:\n`;
        context += `${stripHtml(reply.cooked)}\n\n`;
      });
    }

    return context;
  };

  // Initialize with system message when expanded
  useEffect(() => {
    if (isExpanded && !isInitialized) {
      const context = buildContext();
      conversationHistoryRef.current = [
        {
          role: "system",
          content: `You are a helpful assistant that answers questions about a NEAR governance proposal. Here is the context:

${context}

IMPORTANT: You have access to specialized analysis tools. Use them when relevant:
- summarize_revisions: for questions about changes/edits/modifications
- summarize_proposal: for summary/overview requests
- summarize_discussion: for discussion/replies/comments

Respond in plain text only. No markdown formatting.`,
        },
      ];
      setIsInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, isInitialized]);

  // Auto-scroll
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isExpanded]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
  };

  const addMessage = (
    content: string,
    role: "user" | "assistant",
    messageId?: string,
    toolCalls?: ToolCall[]
  ): Message => {
    const newMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      role,
      timestamp: new Date(),
      messageId,
      toolCalls,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const updateLastMessage = (
    content: string,
    messageId?: string,
    toolCalls?: ToolCall[]
  ) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
          messageId: messageId || updated[updated.length - 1].messageId,
          toolCalls: toolCalls || updated[updated.length - 1].toolCalls,
        };
      }
      return updated;
    });
  };

  const safeParseToolArguments = (
    rawArgs: string
  ): Record<string, unknown> => {
    if (!rawArgs?.trim()) return {};
    try {
      return JSON.parse(rawArgs);
    } catch (parseError) {
      console.warn("Failed to parse tool arguments:", parseError, rawArgs);
      return {};
    }
  };

  const sendStreamingMessage = async () => {
    addMessage("", "assistant");

    const runCompletion = async (
      stream: boolean
    ): Promise<{
      content: string;
      toolCalls: ToolCall[];
      messageId?: string;
    }> => {
      if (stream) {
        let fullContent = "";
        let messageId: string | undefined;
        const toolCallBuffers: Record<number, ToolCall> = {};

        const requestBody = {
          model,
          messages: conversationHistoryRef.current,
          tools,
          tool_choice: "auto",
          stream: true,
        };

        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            `API Error: ${response.status} - ${
              errorData.error || errorData.message || response.statusText
            }`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              if (!messageId && parsed.id) {
                messageId = parsed.id;
              }

              const delta = parsed.choices?.[0]?.delta;

              if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                  const index = toolCallDelta.index ?? 0;
                  const existing = toolCallBuffers[index];

                  if (!existing) {
                    toolCallBuffers[index] = {
                      id: toolCallDelta.id || `${Date.now()}-${index}`,
                      type: toolCallDelta.type || "function",
                      function: {
                        name: toolCallDelta.function?.name || "",
                        arguments: toolCallDelta.function?.arguments || "",
                      },
                    };
                  } else if (toolCallDelta.function?.arguments) {
                    existing.function.arguments +=
                      toolCallDelta.function.arguments;
                  }
                }
              }

              const content = delta?.content;
              if (content) {
                fullContent += content;
                updateLastMessage(
                  fullContent,
                  messageId,
                  Object.values(toolCallBuffers)
                );
              }
            } catch {
              // Ignore malformed JSON chunks
            }
          }
        }

        return {
          content: fullContent,
          toolCalls: Object.values(toolCallBuffers),
          messageId,
        };
      } else {
        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: conversationHistoryRef.current,
            tools,
            tool_choice: "auto",
            stream: false,
          }),
        });

        if (!response.ok) {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(
            `API Error: ${response.status} - ${
              errorData.error || errorData.message || response.statusText
            }`
          );
        }

        const data = await response.json();
        const choice = data.choices?.[0];
        const message = choice?.message ?? {};
        const rawToolCalls = (message.tool_calls as RawToolCall[] | undefined) ?? [];
        const formattedToolCalls: ToolCall[] = rawToolCalls.map((call, index) => ({
          id: call.id ?? `tool-${index}`,
          type: call.type || "function",
          function: {
            name: call.function?.name || "",
            arguments: call.function?.arguments || "",
          },
        }));

        return {
          content: message.content || "",
          toolCalls: formattedToolCalls,
          messageId: choice?.id,
        };
      }
    };

    try {
      let needsResponse = true;
      let useStreaming = true;

      while (needsResponse) {
        const { content, toolCalls, messageId } = await runCompletion(
          useStreaming
        );
        useStreaming = false;

        if (toolCalls.length === 0) {
          updateLastMessage(content || "", messageId);
          conversationHistoryRef.current.push({
            role: "assistant",
            content,
          });
          needsResponse = false;
        } else {
          updateLastMessage(
            content || "Using analysis tools...",
            messageId,
            toolCalls
          );

          conversationHistoryRef.current.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls,
          });

          const toolResults: string[] = [];

          for (const toolCall of toolCalls) {
            const args = safeParseToolArguments(toolCall.function.arguments);
            const result = await executeToolCall(toolCall.function.name, args);

            toolResults.push(
              `Tool ${toolCall.function.name}:\n${result}`.trim()
            );
          }

          if (toolResults.length) {
            conversationHistoryRef.current.push({
              role: "user",
              content: `[Tool Results]\n\n${toolResults.join("\n\n")}`,
            });
          }
          // Continue loop with non-streaming completion for follow-up response
        }
      }
    } catch (error: unknown) {
      setMessages((prev) => prev.slice(0, -1));
      throw error;
    }
  };

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || isLoading) return;

    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    addMessage(message, "user");
    conversationHistoryRef.current.push({ role: "user", content: message });

    setIsLoading(true);
    setError(null);

    try {
      await sendStreamingMessage();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to get response";
      setError(message);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatMessageContent = (content: string) => {
    return content
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/^[-*+]\s+/gm, "• ")
      .replace(/^\d+\.\s+/gm, (match) => match.trim() + " ")
      .replace(/^>\s+/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
  };

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none bg-muted/50 hover:bg-muted/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">Assistant</CardTitle>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          <p className="text-xs">{model}</p>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-0">
          <ScrollArea ref={scrollAreaRef} className="h-[400px] p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <p className="text-sm font-semibold mb-2">Ask me anything!</p>
                <p className="text-xs text-muted-foreground">
                  I can help you understand this proposal, analyze revisions,
                  and provide detailed summaries.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-muted-foreground text-background rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">
                        {formatMessageContent(msg.content)}
                      </p>
                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <Badge variant="outline" className="mt-2 text-xs gap-1">
                          <Wrench className="h-3 w-3" />
                          {msg.toolCalls
                            .map((tc) => tc.function.name)
                            .join(", ")}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && messages[messages.length - 1]?.content === "" && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-xl px-3 py-2 rounded-bl-sm">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="p-3 border-t space-y-2">
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                disabled={isLoading}
                className="flex-1 min-h-[38px] max-h-[100px] resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim()}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
