# NEAR AI Assistant Flow

## Context
- Starts from `tests/e2e/seed.spec.ts`, which already registers mocks and lands on `/` so the planner can reuse the same fixtures/hooks for authentication, verification, and analytics instrumentation.
- Targets `/` and `/chat` (if the assistant exposes a dedicated route) with special attention to the NEAR AI assistant UI, NEAR AI/verification metadata plumbing, and Plausible/governance analytics events (`agent_chat_opened`, `agent_chat_conversation`).

## Test Scenarios

### 1. Entry state & NEAR AI/Verification awareness
- Load `/` and confirm the assistant panel surfaces the welcome/empty convo state (assistant copy, quick-action prompts, empty feed message).
- Assert there is no auth gate, but the UI documents the NEAR AI/verification integration (e.g., tooltip, badge, or status note describing NEAR AI and proof metadata).
- Verify opening the assistant floods the Plausible/governance endpoint with `agent_chat_opened` (mock the analytics call and inspect payload metadata for NEAR AI/verification hints).

### 2. Successful interactions with streaming, quick actions, and tools
- Stub `/api/chat/completions` to stream a payload that includes tool call instructions (proposal list cards) and verification metadata (`proof`, `verificationId`, `nonce`).
- Type a message, submit, and confirm: 1) streaming typing indicator appears, 2) new message pushes the feed down, 3) scroll-to-bottom control (if displayed) is visible/active, 4) tool cards for proposals render inside the feed, and 5) the VerificationProof UI surfaces with the expected metadata.
- Repeat by clicking a quick-action button (e.g., “Summarize latest proposal”) and ensure the same stream/scroll/tool/verification behavior occurs without typing.
- After each send, confirm a Plausible `agent_chat_conversation` (or equivalent) event fires with details about NEAR AI + verification.
- Use the clear-conversation button and verify the feed resets to the empty state while analytics reflect the cleared session.

### 3. Error handling, retries, and cancellation
- Reconfigure the `/api/chat/completions` mock to return HTTP 400; send a message and ensure the assistant surfaces an error CTA/snackbar, stops the typing animation, and offers retry or new message capability.
- Trigger a subsequent send that now succeeds to prove the assistant recovers (mock success + tool cards again).
- Switch the mock to HTTP 500, send another message, assert the error message is distinct, and confirm the streaming indicator halts.
- Verify that attempting to send a new message after the 500 (without reloading) cancels the prior request and processes the fresh one; check that the UI clears loading state before the retry completes.

### 4. Persistence across navigation and repeated analytics
- Keep the assistant open, navigate away (e.g., via header link to proposals or `/chat`), then return to `/`; confirm the previously shown tool cards or empty state persists, scroll position resets or keeps as expected, and quick-action buttons remain enabled.
- Ensure reopening still fires `agent_chat_opened` with analytics mechanisms re-triggered.
- While still on `/`, send two more rapid messages to validate back-to-back requests, verifying each invocation’s tool payloads render, verification proofs show if present, and analytics event fires per conversation/interaction.

### 5. Verification proof + analytics coverage
- Craft a mock reply with `verification: { id: "...", root: "...", ok: true }` and ensure the VerificationProof component (proof badge, modal, etc.) displays details (hash, verifier, status).
- Track that the analytics payload always includes a flag or metadata denoting verification was attached, especially when the proof UI is invoked.

### Notes
- Keep `/api/chat/completions`, Plausible/governance endpoints, and any verification service mocked; avoid real NEAR AI or analytics traffic.
- Mention in the plan that the analytics hook should monitor both page load/open and every send (re-open and repeated messages) for `agent_chat_opened`/`agent_chat_conversation`.
