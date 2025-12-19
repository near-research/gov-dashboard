import type {
  AbstractAgent,
  AgentSubscriber,
  AgentSubscriberParams,
  BaseEvent,
  CustomEvent,
  InputContent,
  Message,
  RunAgentInput,
  RunAgentResult,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
  State,
  StateDeltaEvent,
  StateSnapshotEvent,
  StepFinishedEvent,
  StepStartedEvent,
  MessagesSnapshotEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
  RawEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  ToolCallStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { VerificationMetadata } from "@/lib/near-ai";

const AGENT_ENDPOINT = "/api/agent";
const VERIFICATION_SESSION_ENDPOINT = "/api/verification/session";
const resolveEndpoint = (endpoint: string): string => {
  if (endpoint.startsWith("http")) {
    return endpoint;
  }
  if (typeof window !== "undefined") {
    return endpoint;
  }
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  return new URL(endpoint, base).toString();
};

export interface GovernanceAgentOptions {
  agentId: string;
  onVerification?: (metadata: VerificationMetadata) => void;
  onStateChange?: (delta: unknown) => void;
}

interface ToolCallTracker {
  buffer: string;
  name?: string;
}

export function createGovernanceAgent(options: GovernanceAgentOptions) {
  const agentState = {
    threadId: "",
    messages: [] as Message[],
  };

  async function fetchVerificationSession(agentId: string) {
    const response = await fetch(resolveEndpoint(VERIFICATION_SESSION_ENDPOINT), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ verificationId: agentId }),
    });

    if (!response.ok) {
      throw new Error("Failed to initialize verification session");
    }

    return response.json() as Promise<{ verificationId: string; nonce: string }>;
  }

  function convertMessage(message: Message): Message | null {
    if (message.role === "activity") {
      return message;
    }

    const content = serializeContent(message.content);
    if (!content.trim()) {
      return null;
    }

    return {
      ...message,
      content,
    };
  }

  function convertMessages(messages: Message[] | undefined): Message[] {
    if (!messages) {
      return [];
    }

    return messages
      .map(convertMessage)
      .filter((message): message is Message => !!message);
  }

  function serializeContent(content?: string | InputContent[]): string {
    if (!content) {
      return "";
    }

    if (typeof content === "string") {
      return content;
    }

    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part.type === "text") {
          return part.text;
        }

        if (part.type === "binary") {
          const label = part.filename ?? part.mimeType ?? "binary";
          return `Binary payload (${label})`;
        }

        return renderJson(part);
      })
      .filter(Boolean)
      .join("\n");
  }

  function renderJson(value: unknown) {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return {
    async runAgent(
      input: RunAgentInput,
      subscriber?: AgentSubscriber,
      config?: { signal?: AbortSignal }
    ): Promise<RunAgentResult> {
      agentState.messages = input.messages ?? [];
      agentState.threadId = input.threadId ?? "main";

      const verificationSession = options.onVerification
        ? await fetchVerificationSession(options.agentId).catch((error) => {
            console.warn("Verification session init failed:", error);
            return undefined;
          })
        : undefined;

      const payload: Record<string, unknown> = {
        messages: convertMessages(agentState.messages),
      };

      if (input.threadId) {
        payload.threadId = input.threadId;
      }
      if (input.runId) {
        payload.runId = input.runId;
      }
      if (input.parentRunId) {
        payload.parentRunId = input.parentRunId;
      }
      if (input.state !== undefined) {
        payload.state = input.state;
      }
      if (verificationSession) {
        payload.verificationId = verificationSession.verificationId;
        payload.verificationNonce = verificationSession.nonce;
      }

      if (
        !payload.messages ||
        (Array.isArray(payload.messages) && payload.messages.length === 0)
      ) {
        throw new Error("Agent run requires at least one message");
      }

      let runFinished = false;
      let trackedState: State | undefined = input.state;
      const toolTrackers = new Map<string, ToolCallTracker>();

      const subscriberParams = (): AgentSubscriberParams => ({
        messages: agentState.messages,
        state: trackedState ?? (input.state ?? ({} as State)),
        agent: agentState as unknown as AbstractAgent,
        input,
      });

      const dispatchEvent = (event: BaseEvent) => {
        const params = subscriberParams();
        switch (event.type) {
          case EventType.RUN_STARTED:
            subscriber?.onRunStartedEvent?.({
              event: event as RunStartedEvent,
              ...params,
            });
            return;
          case EventType.RUN_FINISHED:
            runFinished = true;
            subscriber?.onRunFinishedEvent?.({
              event: event as RunFinishedEvent,
              ...params,
            });
            return;
          case EventType.RUN_ERROR:
            subscriber?.onRunErrorEvent?.({
              event: event as RunErrorEvent,
              ...params,
            });
            return;
          case EventType.STEP_STARTED:
            subscriber?.onStepStartedEvent?.({
              event: event as StepStartedEvent,
              ...params,
            });
            return;
          case EventType.STEP_FINISHED:
            subscriber?.onStepFinishedEvent?.({
              event: event as StepFinishedEvent,
              ...params,
            });
            return;
          case EventType.TEXT_MESSAGE_START:
            subscriber?.onTextMessageStartEvent?.({
              event: event as TextMessageStartEvent,
              ...params,
            });
            return;
          case EventType.TEXT_MESSAGE_CONTENT: {
            const textEvent = event as TextMessageContentEvent;
            subscriber?.onTextMessageContentEvent?.({
              event: textEvent,
              ...params,
              textMessageBuffer: textEvent.delta ?? "",
            });
            return;
          }
          case EventType.TEXT_MESSAGE_END: {
            const endEvent = event as TextMessageEndEvent;
            subscriber?.onTextMessageEndEvent?.({
              event: endEvent,
              ...params,
              textMessageBuffer: "",
            });
            return;
          }
          case EventType.TOOL_CALL_START: {
            const toolCallEvent = event as ToolCallStartEvent;
            toolTrackers.set(toolCallEvent.toolCallId, {
              buffer: "",
              name: toolCallEvent.toolCallName,
            });
            subscriber?.onToolCallStartEvent?.({
              event: toolCallEvent,
              ...params,
            });
            return;
          }
          case EventType.TOOL_CALL_ARGS: {
            const argsEvent = event as ToolCallArgsEvent;
            const tracker = toolTrackers.get(argsEvent.toolCallId);
            const updatedBuffer = (tracker?.buffer ?? "") + (argsEvent.delta ?? "");
            toolTrackers.set(argsEvent.toolCallId, {
              buffer: updatedBuffer,
              name: tracker?.name,
            });

            let partialArgs: Record<string, unknown> = {};
            try {
              partialArgs = JSON.parse(updatedBuffer);
            } catch {
              // ignore partial JSON
            }

            subscriber?.onToolCallArgsEvent?.({
              event: argsEvent,
              ...params,
              toolCallBuffer: updatedBuffer,
              toolCallName: tracker?.name ?? "",
              partialToolCallArgs: partialArgs,
            });
            return;
          }
          case EventType.TOOL_CALL_END: {
            const endEvent = event as ToolCallEndEvent;
            const tracker = toolTrackers.get(endEvent.toolCallId);
            const finalBuffer = tracker?.buffer ?? "";
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(finalBuffer);
            } catch {
              // ignore
            }

            subscriber?.onToolCallEndEvent?.({
              event: endEvent,
              ...params,
              toolCallArgs: parsedArgs,
              toolCallName: tracker?.name ?? "",
            });
            toolTrackers.delete(endEvent.toolCallId);
            return;
          }
          case EventType.TOOL_CALL_RESULT:
            subscriber?.onToolCallResultEvent?.({
              event: event as ToolCallResultEvent,
              ...params,
            });
            return;
          case EventType.STATE_SNAPSHOT: {
            const snapshot = event as StateSnapshotEvent;
            trackedState = snapshot.snapshot;
            subscriber?.onStateSnapshotEvent?.({
              event: snapshot,
              ...params,
            });
            return;
          }
          case EventType.STATE_DELTA: {
            const deltaEvent = event as StateDeltaEvent;
            options.onStateChange?.(deltaEvent.delta);
            subscriber?.onStateDeltaEvent?.({
              event: deltaEvent,
              ...params,
            });
            return;
          }
          case EventType.MESSAGES_SNAPSHOT: {
            const messagesEvent = event as MessagesSnapshotEvent;
            agentState.messages = messagesEvent.messages;
            subscriber?.onMessagesSnapshotEvent?.({
              event: messagesEvent,
              ...params,
            });
            return;
          }
          case EventType.ACTIVITY_SNAPSHOT:
            subscriber?.onActivitySnapshotEvent?.({
              event: event as ActivitySnapshotEvent,
              ...params,
            });
            return;
          case EventType.ACTIVITY_DELTA:
            subscriber?.onActivityDeltaEvent?.({
              event: event as ActivityDeltaEvent,
              ...params,
            });
            return;
          case EventType.RAW:
            subscriber?.onRawEvent?.({
              event: event as RawEvent,
              ...params,
            });
            return;
          case EventType.CUSTOM:
            subscriber?.onCustomEvent?.({
              event: event as CustomEvent,
              ...params,
            });
            return;
          default:
            subscriber?.onEvent?.({
              event,
              ...params,
            });
        }
      };

      try {
        const response = await fetch(resolveEndpoint(AGENT_ENDPOINT), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: config?.signal,
        });

        if (!response.ok) {
          throw new Error(`Agent request failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Agent stream did not provide a body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processBuffer = () => {
          let index: number;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 2);
            if (!raw.startsWith("data:")) {
              continue;
            }
            const payloadText = raw.slice(5).trim();
            if (!payloadText || payloadText === "[DONE]") {
              continue;
            }
            try {
              const parsed = JSON.parse(payloadText);
              if (parsed && parsed.type === "verification") {
                if (parsed.verification) {
                  options.onVerification?.(parsed.verification);
                }
                continue;
              }

              dispatchEvent(parsed as BaseEvent);
            } catch (error) {
              console.error("Failed to parse agent event:", error, payloadText);
            }
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              processBuffer();
            }
            if (done) {
              break;
            }
          }
          buffer += decoder.decode();
          processBuffer();
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        subscriber?.onRunFailed?.({ error: err, ...subscriberParams() });
        throw err;
      }

      if (!runFinished) {
        subscriber?.onRunFinalized?.({ ...subscriberParams() });
      }

      return { result: null, newMessages: [] };
    },
  };
}
