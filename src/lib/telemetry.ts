import { logger } from "@/lib/logger";
type TelemetryEvent = {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number;
};

class Telemetry {
  private enabled: boolean;
  private shouldDebug: boolean;

  constructor() {
    this.enabled = process.env.TELEMETRY_ENABLED !== "false";
    this.shouldDebug =
      process.env.NODE_ENV === "development" || process.env.DEBUG === "true";
  }

  track(name: string, properties: Record<string, unknown> = {}) {
    if (!this.enabled) return;

    const event: TelemetryEvent = {
      name,
      properties: {
        ...properties,
        environment: process.env.NODE_ENV,
        service: "neargov-agent",
      },
      timestamp: Date.now(),
    };

    if (this.shouldDebug) {
      logger.debug("Telemetry event", event);
    }
  }

  agentRunStarted(runId: string, threadId: string, userId?: string) {
    this.track("agent.run.started", { runId, threadId, userId });
  }

  agentRunCompleted(runId: string, iterations: number, durationMs: number) {
    this.track("agent.run.completed", { runId, iterations, durationMs });
  }

  agentRunFailed(runId: string, error: string, iteration: number) {
    this.track("agent.run.failed", { runId, error, iteration });
  }

  toolExecuted(runId: string, toolName: string, durationMs: number, success: boolean) {
    this.track("agent.tool.executed", {
      runId,
      toolName,
      durationMs,
      success,
    });
  }

  verificationCompleted(runId: string, verdict: string, proposalId?: string) {
    this.track("agent.verification.completed", {
      runId,
      verdict,
      proposalId,
    });
  }
}

export const telemetry = new Telemetry();
