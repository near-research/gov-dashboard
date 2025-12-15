import React, { useState } from "react";
import type { ToolCallUIEvent } from "@/types/agent-ui";
import { Button } from "@/components/ui/button";

export type ToolHistoryStatus = "active" | "awaiting_response" | "completed";

const renderStructuredBlock = (title: string, value?: string) => {
  if (!value) return null;
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    formatted = value;
  }
  return (
    <div className="text-[11px] text-blue-900 space-y-1">
      <p className="uppercase tracking-wide text-[10px] font-semibold text-blue-700">
        {title}
      </p>
      <pre className="bg-white/70 border border-blue-100 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
        {formatted}
      </pre>
    </div>
  );
};

const ToolStatusIcon = ({ status }: { status: ToolCallUIEvent["status"] }) => {
  switch (status) {
    case "completed":
      return <span className="text-green-600 font-bold">✓</span>;
    case "failed":
      return <span className="text-red-600 font-bold">✗</span>;
    case "running":
      return (
        <div className="flex gap-0.5">
          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce" />
          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:0.15s]" />
          <div className="w-1 h-1 bg-blue-500 rounded-full animate-bounce [animation-delay:0.3s]" />
        </div>
      );
    case "pending":
      return <span className="text-gray-400">○</span>;
    default:
      return null;
  }
};

interface ToolHistoryCardProps {
  status: ToolHistoryStatus;
  tools: ToolCallUIEvent[];
}

export const ToolHistoryCard = ({ status, tools }: ToolHistoryCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const statusLabel =
    status === "active"
      ? {
          text: "Thinking…",
          indicatorClass: "bg-blue-500",
          textClass: "text-blue-900",
        }
      : status === "awaiting_response"
      ? {
          text: "Preparing response…",
          indicatorClass: "bg-blue-400",
          textClass: "text-blue-800",
        }
      : null;


  return (
    <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 max-w-[80%]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          {statusLabel ? (
            <>
              <div className={`w-2 h-2 rounded-full animate-pulse ${statusLabel.indicatorClass}`} />
              <p className={`text-sm font-semibold ${statusLabel.textClass}`}>{statusLabel.text}</p>
            </>
          ) : (
            <p className="text-sm font-semibold text-blue-700">Tools Used</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs h-7"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Hide" : "Show"}
        </Button>
      </div>
      <div className="space-y-3">
        {tools.map((tool) => {
          const isActive = tool.status === "running" || tool.status === "pending";

          return (
            <div key={tool.id} className="space-y-2">
              <div
                className={`flex items-center gap-2 text-xs ${
                  isActive
                    ? "text-blue-700 font-medium"
                    : tool.status === "completed"
                    ? "text-blue-600/70"
                    : tool.status === "failed"
                    ? "text-red-600/70"
                    : "text-gray-500"
                }`}
              >
                <ToolStatusIcon status={tool.status} />
                <span className="font-semibold">{tool.toolName}</span>
              </div>
              {expanded && (
                <>
                  {renderStructuredBlock("Input", tool.input)}
                  {renderStructuredBlock("Result", tool.output as string)}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
