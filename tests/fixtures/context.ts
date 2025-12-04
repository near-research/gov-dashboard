export const mockSession = {
  user: {
    id: "user-123",
    email: "user@example.com",
    nearAccountId: "example.near",
  },
  session: {
    id: "session-abc",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
};

export const createMockHeaders = () => ({
  cookie: "session=abc",
  "x-verification-id": "ver-123",
  "x-nonce": "nonce-abc",
  "set-cookie": ["sid=one", "sid=two"],
});
