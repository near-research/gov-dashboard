import { vi } from "vitest";

export const createNearAiClientMock = () => {
  const createSession = vi.fn((id: string) => ({
    nonce: "mock-nonce",
    createdAt: Date.now(),
    expiresAt: Date.now() + 300_000,
  }));
  const updateSessionHashes = vi.fn();
  const clearSession = vi.fn();
  const chatCompletions = vi.fn();
  const chatCompletionsStream = vi.fn();
  const getConfig = () => ({ baseUrl: "https://example.com", apiKey: "test" });

  return {
    client: {
      chatCompletions,
      chatCompletionsStream,
      getConfig,
      createSession,
      updateSessionHashes,
      clearSession,
    },
    spies: { createSession, updateSessionHashes, clearSession },
  };
};
export type NearAiClientMock = ReturnType<typeof createNearAiClientMock>["client"];
