import type {
  AgentState,
  CompletionMessage,
  MessageRole,
} from "@/types/agui-events";

export interface AgentRequestBody {
  messages: Array<{ role: MessageRole; content: string }>;
  threadId?: string;
  runId?: string;
  state?: Partial<AgentState>;
  verificationId?: string;
  verificationNonce?: string;
}

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
  verificationId?: string;
  toolStepStarted: boolean;
  rawSseText: string;
};
