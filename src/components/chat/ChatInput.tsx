// components/chat/ChatInput.tsx
import React, {
  useState,
  useRef,
  useEffect,
  useId,
  KeyboardEvent,
  ChangeEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Send, Trash2 } from "lucide-react";

export type ChatQuickAction = {
  label: string;
  message: string;
};

interface ChatInputProps {
  onSend: (message: string) => void;
  onClear: () => void;
  isLoading: boolean;
  error: string | null;
  placeholder?: string;
  disabled?: boolean;
  canClear?: boolean;
  onHeightChange?: (height: number) => void;
  quickActions?: ChatQuickAction[];
}

export const ChatInput = ({
  onSend,
  onClear,
  isLoading,
  error,
  placeholder = "Ask me anything...",
  disabled = false,
  canClear = false,
  onHeightChange,
  quickActions = [],
}: ChatInputProps) => {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  const adjustTextareaHeight = () => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    adjustTextareaHeight();
  };

  const handleSend = () => {
    const message = inputValue.trim();
    if (!message || isLoading || disabled) return;

    onSend(message);
    setInputValue("");
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (message: string) => {
    if (!message || isLoading || disabled) return;
    onSend(message);
    setInputValue("");
    adjustTextareaHeight();
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!onHeightChange) return;
    const node = containerRef.current;
    if (!node) return;

    const notify = () => onHeightChange(node.getBoundingClientRect().height);
    notify();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", notify);
      return () => window.removeEventListener("resize", notify);
    }

    const observer = new ResizeObserver(() => notify());
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 border-t bg-background/95 px-4 sm:px-6 py-6 sm:py-8 backdrop-blur supports-[backdrop-filter]:bg-background/85 z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
    >
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight mb-3">
            NEAR Gov Assistant
          </h2>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant="secondary"
                size="sm"
                disabled={isLoading || disabled}
                onClick={() => handleQuickAction(action.message)}
                className="shadow-sm"
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-5 pb-2">
          <div className="flex-1 flex flex-col">
            <label htmlFor={inputId} className="sr-only">
              Message to NEAR Gov Assistant
            </label>
            <textarea
              id={inputId}
              data-testid="chat-input"
              ref={inputRef}
              value={inputValue}
              onChange={handleInputChange}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              disabled={isLoading || disabled}
              aria-describedby={hintId}
              className="flex-1 max-h-[120px] resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
              rows={1}
            />
            <span id={hintId} className="sr-only">
              Press Enter to send, Shift+Enter for a new line
            </span>
          </div>
          <Button
            data-testid="chat-send-button"
            onClick={handleSend}
            disabled={isLoading || !inputValue.trim() || disabled}
            size="icon"
            className="shadow-sm"
            aria-label="Send message"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
          <Button
            data-testid="chat-clear-button"
            variant="outline"
            size="icon"
            onClick={onClear}
            disabled={isLoading || !canClear}
            className="shadow-sm"
            aria-label="Clear conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
