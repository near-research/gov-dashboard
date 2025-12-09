import { describe, expect, it } from "vitest";
import type { AGUIEvent } from "@/types/agui-events";
import {
  EventType,
  type MessageRole,
} from "@/types/agui-events";
import {
  mapRoleToDisplayRoleMeta,
  reduceAguiEventsToUiEvents,
  type AgentUIEvent,
  type MessageUIEvent,
  type StatusUIEvent,
  type ToolCallUIEvent,
  type ToolResultUIEvent,
} from "@/types/agent-ui";

const baseDate = new Date("2024-01-01T00:00:00.000Z");
const timestampAt = (offset = 0): number => baseDate.getTime() + offset;

describe("agent-ui runtime utilities", () => {
  it("maps AG-UI roles to display metadata", () => {
    const expectations: Record<MessageRole, { role: string; label: string }> =
      {
        developer: { role: "system", label: "Developer" },
        tool: { role: "assistant", label: "Tool" },
        assistant: { role: "assistant", label: "Agent" },
        system: { role: "system", label: "System" },
        user: { role: "user", label: "You" },
      };

    (Object.keys(expectations) as MessageRole[]).forEach((role) => {
      expect(mapRoleToDisplayRoleMeta(role)).toEqual(expectations[role]);
    });
  });

  it("reduces streaming text events into a completed assistant message", () => {
    const startEvent: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-stream",
      role: "assistant",
      timestamp: timestampAt(0),
    } as AGUIEvent;

    const contentEvent: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-stream",
      delta: "Hello, ",
      timestamp: timestampAt(10),
    } as AGUIEvent;

    const moreContentEvent: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "msg-stream",
      delta: "world!",
      timestamp: timestampAt(20),
    } as AGUIEvent;

    const endEvent: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_END,
      messageId: "msg-stream",
      timestamp: timestampAt(30),
    } as AGUIEvent;

    let events: AgentUIEvent[] = [];
    events = reduceAguiEventsToUiEvents(events, startEvent);
    events = reduceAguiEventsToUiEvents(events, contentEvent);
    events = reduceAguiEventsToUiEvents(events, moreContentEvent);
    events = reduceAguiEventsToUiEvents(events, endEvent);

    const [messageEvent] = events as MessageUIEvent[];
    expect(messageEvent.kind).toBe("message");
    expect(messageEvent.status).toBe("completed");
    expect(messageEvent.content).toBe("Hello, world!");
    expect(messageEvent.messageId).toBe("msg-stream");
    expect(messageEvent.rawEvents?.map((raw) => raw.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
  });

  it("tracks a tool call lifecycle and publishes a tool result", () => {
    const toolCallId = "call-123";
    const startEvent: AGUIEvent = {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: "Echo",
      timestamp: timestampAt(40),
    } as AGUIEvent;

    const argsEvent: AGUIEvent = {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: '{"phrase": "hello"}',
      timestamp: timestampAt(50),
    } as AGUIEvent;

    const endEvent: AGUIEvent = {
      type: EventType.TOOL_CALL_END,
      toolCallId,
      timestamp: timestampAt(60),
    } as AGUIEvent;

    const resultEvent: AGUIEvent = {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      toolCallName: "Echo",
      messageId: "msg-tool",
      content: "resp",
      timestamp: timestampAt(70),
    } as AGUIEvent;

    let events: AgentUIEvent[] = [];
    events = reduceAguiEventsToUiEvents(events, startEvent);
    events = reduceAguiEventsToUiEvents(events, argsEvent);
    events = reduceAguiEventsToUiEvents(events, endEvent);
    events = reduceAguiEventsToUiEvents(events, resultEvent);

    const toolCallEvent = events.find(
      (event) => event.kind === "tool_call"
    ) as ToolCallUIEvent;
    const toolResultEvent = events.find(
      (event) => event.kind === "tool_result"
    ) as ToolResultUIEvent;

    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent.toolCallId).toBe(toolCallId);
    expect(toolCallEvent.status).toBe("completed");
    expect(toolCallEvent.input).toBe('{"phrase": "hello"}');
    expect(toolCallEvent.rawEvents?.some((event) => event.type === EventType.TOOL_CALL_RESULT)).toBe(
      true
    );
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent.toolCallId).toBe(toolCallId);
    expect(toolResultEvent.output).toBe("resp");
  });

  it("appends status events for run/step signals", () => {
    const events: AgentUIEvent[] = [];
    const statuses = [
      {
        event: {
          type: EventType.RUN_STARTED,
          timestamp: timestampAt(80),
        } as AGUIEvent,
        label: "Agent run started",
        level: "info",
      },
      {
        event: {
          type: EventType.STEP_STARTED,
          stepName: "phase-1",
          timestamp: timestampAt(90),
        } as AGUIEvent,
        label: "Step started: phase-1",
        level: "info",
      },
      {
        event: {
          type: EventType.STEP_FINISHED,
          stepName: "phase-1",
          timestamp: timestampAt(100),
        } as AGUIEvent,
        label: "Step finished: phase-1",
        level: "success",
      },
      {
        event: {
          type: EventType.RUN_FINISHED,
          timestamp: timestampAt(110),
        } as AGUIEvent,
        label: "Agent run finished",
        level: "success",
      },
      {
        event: {
          type: EventType.RUN_ERROR,
          message: "boom",
          code: "C0",
          timestamp: timestampAt(120),
        } as AGUIEvent,
        label: "boom",
        level: "error",
      },
    ];

    const accumulated = statuses.reduce<AgentUIEvent[]>(
      (acc, signal) => reduceAguiEventsToUiEvents(acc, signal.event),
      events
    );

    const statusEvents = accumulated.filter(
      (event): event is StatusUIEvent => event.kind === "status"
    );

    expect(statusEvents).toHaveLength(statuses.length);
    statuses.forEach((expectation, index) => {
      expect(statusEvents[index].label).toBe(expectation.label);
      expect(statusEvents[index].level).toBe(expectation.level);
    });
  });

  it("ignores unknown event types and preserves the previous array", () => {
    const previous: AgentUIEvent[] = [];
    const unknownEvent = {
      type: EventType.CUSTOM,
      name: "UNKNOWN_EVENT",
      value: null,
    } as AGUIEvent;
    const result = reduceAguiEventsToUiEvents(previous, unknownEvent);
    expect(result).toBe(previous);
  });

  it("handles chunks without a messageId gracefully", () => {
    const chunkEvent: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_CHUNK,
      delta: "chunked content",
      timestamp: timestampAt(130),
    } as AGUIEvent;

    const [messageEvent] = reduceAguiEventsToUiEvents(
      [],
      chunkEvent
    ) as MessageUIEvent[];
    expect(messageEvent.kind).toBe("message");
    expect(messageEvent.content).toBe("chunked content");
    expect(messageEvent.status).toBe("completed");
    expect(messageEvent.messageId).toBeUndefined();
  });

  it("recovers from malformed content events without blowing up", () => {
    const malformed: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      timestamp: timestampAt(140),
    } as AGUIEvent;

    const [messageEvent] = reduceAguiEventsToUiEvents(
      [],
      malformed
    ) as MessageUIEvent[];
    expect(messageEvent.content).toBe("");
    expect(messageEvent.rawEvents?.[0].type).toBe(
      EventType.TEXT_MESSAGE_CONTENT
    );
  });

  it("generates tool calls for results without an ID and preserves the payload", () => {
    const toolResult: AGUIEvent = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "msg-tool-no-id",
      toolCallName: "NoId",
      content: { value: 42 },
      timestamp: timestampAt(150),
    } as AGUIEvent;

    const events = reduceAguiEventsToUiEvents([], toolResult);
    const toolCallEvent = events.find(
      (event): event is ToolCallUIEvent => event.kind === "tool_call"
    );
    const toolResultEvent = events.find(
      (event): event is ToolResultUIEvent => event.kind === "tool_result"
    );

    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent?.toolName).toBe("Tool call");
    expect(toolCallEvent?.toolCallId).toBeDefined();
    expect(toolResultEvent?.output).toEqual({ value: 42 });
    expect(toolCallEvent?.rawEvents?.some((event) => event.type === EventType.TOOL_CALL_RESULT)).toBe(
      true
    );
  });

  it("preserves timestamps after serialization and deserialization", () => {
    const original: AGUIEvent = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "round-trip",
      role: "assistant",
      timestamp: baseDate.toISOString(),
    } as AGUIEvent;

    const serialized = JSON.parse(JSON.stringify(original)) as AGUIEvent;
    const [messageEvent] = reduceAguiEventsToUiEvents(
      [],
      serialized
    ) as MessageUIEvent[];

    expect(messageEvent.timestamp).toBeInstanceOf(Date);
    expect(messageEvent.timestamp?.toISOString()).toBe(
      baseDate.toISOString()
    );
  });
});
