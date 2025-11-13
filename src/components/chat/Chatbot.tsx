import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Trash2 } from "lucide-react";

interface Message {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
  messageId?: string;
}

interface ChatbotProps {
  model?: string;
  className?: string;
  placeholder?: string;
  welcomeMessage?: string;
}

export const Chatbot = ({
  model = "openai/gpt-oss-120b",
  className = "",
  placeholder = "Ask me anything...",
  welcomeMessage = "Welcome to NEAR AI Assistant. How can I help you today?",
}: ChatbotProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationHistoryRef = useRef<
    Array<{ role: string; content: string }>
  >([]);

  // Auto-scroll to bottom
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

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    setIsInitialized(true);
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
  };

  const addMessage = (
    content: string,
    role: "user" | "assistant",
    messageId?: string
  ): Message => {
    const newMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      content,
      role,
      timestamp: new Date(),
      messageId,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const updateLastMessage = (content: string, messageId?: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
          messageId: messageId || updated[updated.length - 1].messageId,
        };
      }
      return updated;
    });
  };

  const sendStreamingMessage = async (userMessage: string) => {
    let fullContent = "";
    let messageId: string | undefined;

    // Add empty assistant message for streaming
    addMessage("", "assistant");

    const requestBody = {
      model,
      messages: conversationHistoryRef.current,
      stream: true,
    };

    try {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
      if (!reader) throw new Error("Response body is not readable");

      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);

            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (!messageId && parsed.id) {
                messageId = parsed.id;
              }

              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                updateLastMessage(fullContent, messageId);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      conversationHistoryRef.current.push({
        role: "assistant",
        content: fullContent,
      });
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
      await sendStreamingMessage(message);
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : "Failed to get response";
      setError(messageText);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    if (window.confirm("Clear chat history?")) {
      setMessages([]);
      conversationHistoryRef.current = [];
      setError(null);
    }
  };

  return (
    <Card className={className}>
      <CardContent className="p-6 space-y-4">
        {/* Messages */}
        <ScrollArea ref={scrollAreaRef} className="h-[500px] pr-4">
          {messages.length === 0 && isInitialized ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <h3 className="text-lg font-semibold mb-2">Welcome</h3>
              <p className="text-sm text-muted-foreground">{welcomeMessage}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </p>
                    {msg.messageId && msg.role === "assistant" && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        Verifiable
                      </Badge>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.content === "" && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-3 rounded-bl-sm">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            disabled={isLoading}
            className="flex-1 min-h-[44px] max-h-[150px] resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            rows={1}
          />
          <Button
            variant="outline"
            size="icon"
            onClick={clearChat}
            disabled={isLoading || messages.length === 0}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim()}
            size="icon"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
