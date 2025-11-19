// components/chat/ToolMessage.tsx
import { Badge } from "@/components/ui/badge";
type ToolCallStatus = "pending" | "running" | "completed" | "failed";

interface ToolMessageProps {
  kind: "tool_call" | "tool_result";
  toolName: string;
  payload?: unknown;
  status: ToolCallStatus;
}

const toolStatusTone: Record<ToolCallStatus, string> = {
  pending: "bg-amber-100 text-amber-900",
  running: "bg-blue-100 text-blue-900",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

const stringifyPayload = (value: unknown) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const ToolMessage = ({
  kind,
  toolName,
  payload,
  status,
}: ToolMessageProps) => {
  const title = kind === "tool_result" ? "Tool result" : "Tool call";
  const hasPayload = payload !== undefined && payload !== null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">
            {title}: {toolName}
          </p>
          <Badge className={`${toolStatusTone[status]} text-xs`}>
            {status}
          </Badge>
        </div>
        {hasPayload && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-white/80 p-2 text-xs text-slate-900">
            {stringifyPayload(payload)}
          </pre>
        )}
      </div>
    </div>
  );
};
