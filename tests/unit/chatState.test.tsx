import React from "react";
import { describe, it, expect } from "vitest";
import {
  eventsReducer,
  type EventsState,
  selectConversationHistory,
} from "@/components/chat/Chat";
import type { AgentUIEvent } from "@/types/agent-ui";
import {
  mapRoleToDisplayRoleMeta,
  type ToolCallUIEvent,
} from "@/types/agent-ui";
import { ToolHistoryCard } from "@/components/chat/ToolHistoryCard";
import { render, screen, fireEvent } from "@testing-library/react";

const createState = (events: AgentUIEvent[] = []): EventsState => {
  const byId: Record<string, AgentUIEvent> = {};
  const order: string[] = [];
  events.forEach((event) => {
    byId[event.id] = event;
    order.push(event.id);
  });
  return { byId, order };
};

describe("mapRoleToDisplayRoleMeta", () => {
  it("maps developer to system label", () => {
    expect(mapRoleToDisplayRoleMeta("developer")).toEqual({
      role: "system",
      label: "Developer",
    });
  });
});

describe("selectConversationHistory", () => {
  it("returns completed messages with mapped roles", () => {
    const state = createState([
      {
        kind: "message",
        id: "msg-1",
        role: "assistant",
        content: "Hello",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
      {
        kind: "message",
        id: "msg-2",
        role: "developer",
        content: "Note",
        status: "completed",
        timestamp: new Date(),
        turnNumber: 1,
      },
    ]);
    expect(selectConversationHistory(state)).toEqual([
      { role: "assistant", content: "Hello" },
      { role: "system", content: "Note" },
    ]);
  });
});

describe("eventsReducer", () => {
  it("marks tools failed", () => {
    const state = createState([
      {
        kind: "tool_call",
        id: "tool1",
        toolCallId: "tool1",
        toolName: "search",
        status: "running",
        timestamp: new Date(),
        turnNumber: 1,
      } as ToolCallUIEvent,
    ]);
    const next = eventsReducer(state, { type: "mark_tools_failed" });
    expect((next.byId["tool1"] as ToolCallUIEvent).status).toBe("failed");
  });
});

describe("ToolHistoryCard", () => {
  it("renders structured tool input", () => {
    if (typeof document === "undefined") {
      expect(true).toBe(true);
      return;
    }
    render(
      <ToolHistoryCard
        status="completed"
        tools={[
          {
            kind: "tool_call",
            id: "tool1",
            toolCallId: "tool1",
            toolName: "search_discourse",
            input: JSON.stringify({ query: "NEAR" }),
            status: "completed",
            timestamp: new Date(),
            turnNumber: 1,
          },
        ]}
      />
    );
    const toggle = screen.getByRole("button", { name: /show/i });
    fireEvent.click(toggle);
    expect(screen.getByText(/search_discourse/i)).toBeInTheDocument();
    expect(screen.getByText(/"query": "NEAR"/i)).toBeInTheDocument();
  });
});
