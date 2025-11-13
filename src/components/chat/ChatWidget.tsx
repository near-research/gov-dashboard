import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, X, Send } from "lucide-react";
import { cn } from "@/utils/tailwind";

interface CompactMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
}

interface NEARChatWidgetProps {
  apiKey?: string;
  model?: string;
  position?: "bottom-right" | "bottom-left";
}

export const NEARChatWidget = ({
  apiKey = process.env.NEXT_PUBLIC_NEARAI_API_KEY || "",
  model = "openai/gpt-oss-120b",
  position = "bottom-right",
}: NEARChatWidgetProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<CompactMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const conversationHistoryRef = useRef<
    Array<{ role: string; content: string }>
  >([]);

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

  const addMessage = (
    content: string,
    role: "user" | "assistant"
  ): CompactMessage => {
    const newMessage: CompactMessage = {
      id: Date.now().toString(),
      content,
      role,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const updateLastMessage = (content: string) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content,
        };
      }
      return updated;
    });
  };

  const sendMessage = async (userMessage: string) => {
    let fullContent = "";
    addMessage("", "assistant");

    try {
      const response = await fetch(
        "https://cloud-api.near.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: conversationHistoryRef.current,
            stream: true,
          }),
        }
      );

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

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
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                updateLastMessage(fullContent);
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
      console.error("Error:", error);
      setMessages((prev) => prev.slice(0, -1));
      addMessage(
        error instanceof Error
          ? `Sorry, I encountered an error: ${error.message}`
          : "Sorry, I encountered an error. Please try again.",
        "assistant"
      );
    }
  };

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || isLoading || !apiKey) return;

    setInputValue("");
    addMessage(message, "user");
    conversationHistoryRef.current.push({ role: "user", content: message });

    setIsLoading(true);
    await sendMessage(message);
    setIsLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const positionClasses =
    position === "bottom-right" ? "bottom-6 right-6" : "bottom-6 left-6";

  return (
    <div className={cn("fixed z-50", positionClasses)}>
      {/* Chat Window */}
      {isOpen && (
        <Card className="mb-4 w-[380px] shadow-2xl animate-in slide-in-from-bottom-4">
          <CardHeader className="bg-gradient-to-r from-primary to-purple-600 text-primary-foreground">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">AI Assistant</CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <ScrollArea ref={scrollAreaRef} className="h-[400px] p-4">
              {messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-2">
                    <div className="text-sm text-muted-foreground">
                      Hi! I can help you with NEAR governance and proposals.
                      What would you like to know?
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                        msg.role === "user"
                          ? "bg-gradient-to-r from-primary to-purple-600 text-primary-foreground rounded-br-sm"
                          : "bg-muted text-foreground rounded-bl-sm"
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="border-t p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type your message..."
                  disabled={isLoading}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
        </Card>
      )}

      {/* Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        size="icon"
        className="h-14 w-14 rounded-full shadow-lg bg-gradient-to-r from-primary to-purple-600 hover:scale-105 transition-transform"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </Button>
    </div>
  );
};
