import "../../vi-compat";
import { describe, it, expect } from "vitest";

import {
  AGENT_MODEL,
  AGENT_TOOLS,
  buildAgentRequest,
} from "@/server/tools";
import { PROPOSAL_TOOLS } from "@/server/tools/proposals";
import { DISCOURSE_TOOLS } from "@/server/tools/discourse";
import { DOCS_TOOLS } from "@/server/tools/docs";

describe("server tools index", () => {
  it("merges all tools and infers proposal tool choice", () => {
    const messages = [{ role: "user" as const, content: "please screen this" }];
    const { requestBody, toolChoice } = buildAgentRequest({
      messages,
      state: { title: "My Proposal", content: "Body" },
      model: AGENT_MODEL,
    });

    expect(requestBody.model).toBe(AGENT_MODEL);
    expect(requestBody.tools).toHaveLength(
      PROPOSAL_TOOLS.length + DISCOURSE_TOOLS.length + DOCS_TOOLS.length
    );
    expect(toolChoice).toEqual({
      type: "function",
      function: { name: "screen_proposal" },
    });
    expect(requestBody.tool_choice).toEqual(toolChoice);
    expect(requestBody.stream).toBe(true);
    expect(requestBody.messages[0].content).toContain(
      "NEAR governance proposal assistant"
    );
    expect(requestBody.messages[0].content).toContain(
      "Discourse Forum Tools"
    );
    expect(requestBody.messages[0].content).toContain(
      "House of Stake Documentation Tools"
    );
  });

  it("returns auto tool choice when intent is ambiguous", () => {
    const { toolChoice, requestBody } = buildAgentRequest({
      messages: [{ role: "user" as const, content: "tell me more" }],
      model: "openai/mock",
    });

    expect(toolChoice).toBe("auto");
    expect(requestBody.tool_choice).toBe("auto");
    expect(requestBody.messages[0].role).toBe("system");
    expect(requestBody.messages[1].content).toBe("tell me more");
  });
});
