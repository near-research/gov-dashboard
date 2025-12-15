import { vi } from "vitest";

export const createNearAiClientMock = () => {
  const chatCompletions = vi.fn();
  const chatCompletionsStream = vi.fn();
  const getConfig = vi.fn(() => ({
    baseUrl: "https://example.com",
    apiKey: "test",
  }));

  return {
    chatCompletions,
    chatCompletionsStream,
    getConfig,
  };
};
export type NearAiClientMock = ReturnType<typeof createNearAiClientMock>;
