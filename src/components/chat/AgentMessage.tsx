// components/chat/AgentMessage.tsx
import React from "react";
import { Badge } from "@/components/ui/badge";

type AgentPhase = "spawned" | "running" | "completed" | "failed";

interface AgentMessageProps {
  agentName: string;
  phase: AgentPhase;
  detail?: string;
}

export const AgentMessage = ({
  agentName,
  phase,
  detail,
}: AgentMessageProps) => {
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{agentName}</p>
          <Badge className="bg-purple-200 text-purple-900 text-xs">
            {phase}
          </Badge>
        </div>
        {detail && <p className="mt-1 text-xs text-purple-800">{detail}</p>}
      </div>
    </div>
  );
};
