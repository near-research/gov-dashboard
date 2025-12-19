import type {
  AgentState,
  CompletionMessage,
  MessageRole,
} from "@/types/agui-events";
export interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  state?: Partial<AgentState>;
}

export type AgentConversationMessage = {
  role: string;
  content: string;
  tool_calls?: CompletionMessage["tool_calls"];
  tool_call_id?: string;
};

export type ToolCallArgs = {
  title?: string;
  content?: string;
  query?: string;
  limit?: number;
  topic_id?: string;
  post_id?: string;
  doc_key?: string;
  topic?: string;
};

export type ToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

export type ValidatedAgentRequest =
  | {
      ok: true;
      body: AgentRequestBody;
      thread: string;
      run: string;
      runtimeBaseUrl: string;
    }
  | { ok: false; status: number; error: string };

export type StreamResult = {
  content: string;
  toolCalls?: CompletionMessage["tool_calls"];
  finishReason: string | null;
  toolStepStarted: boolean;
  rawSseText: string;
};
