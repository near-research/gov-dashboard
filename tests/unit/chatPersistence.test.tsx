import { describe, expect, it } from "vitest";
import { prepareEventsForPersistence } from "@/components/chat/Chat";
import type { AgentUIEvent } from "@/types/agent-ui";

const buildEvents = (count: number, content = "ok"): AgentUIEvent[] =>
  Array.from({ length: count }).map((_, idx) => ({
    kind: "message",
    id: `msg-${idx}`,
    role: "user",
    content,
    status: "completed",
    timestamp: new Date(),
    turnNumber: idx + 1,
  }));

describe("prepareEventsForPersistence", () => {
  it("keeps only the most recent 200 events", () => {
    const events = buildEvents(250);
    const trimmed = prepareEventsForPersistence(events);
    expect(trimmed.length).toBe(200);
    expect(trimmed[0]?.id).toBe("msg-50");
    expect(trimmed[trimmed.length - 1]?.id).toBe("msg-249");
  });

  it("drops oldest events to satisfy byte budget", () => {
    const bigContent = "x".repeat(30_000);
    const events = buildEvents(3, bigContent);
    const trimmed = prepareEventsForPersistence(events);
    expect(trimmed.length).toBe(1);
    expect(trimmed[0]?.id).toBe("msg-2");
  });
});
