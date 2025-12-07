# Proposal Topic Drill Plan (based on `seed.spec.ts` template)

**Objective:** verify the `/proposals/<topic_id>` path renders and behaves correctly by walking through every client-visible branch described in the product request, covering the loading/error states, populated view, summary/revision/sidebar interactions, verification badges, replies, chat tools, and analytics hooks.

## Preliminaries
1. Reuse `tests/e2e/helpers/playwright-mocks` (as in `seed.spec.ts`) to stub Discourse, NEAR AI, verification proofs, screening, and analytics endpoints, ensuring deterministic responses for:
   - Latest Discourse listings and topic details (including metadata, reply list, and version history).
   - `/api/proposals/<topic>/summaries`, `/api/discourse/topics/<topic>/summarize`, `/api/proposals/<topic>/revisions`, `/api/discourse/topics/<topic>/views` (or any other endpoints the UI hits when expanding summaries/revisions).
   - NEAR AI streaming responses with optional `verification` metadata so we can assert badges when provided.
   - Analytics endpoints receiving events like `proposal_chatbot_summary_request`, `proposal_chatbot_screening`, etc.

2. Start at `/proposals`, click into a topic link, and wait for the `/proposals/<topic_id>` client screen to start rendering.

## Loading/Error/Success States
- Confirm the initial loading skeleton appears while the topic metadata request is pending, and disappears once populated.
- Force the primary Discourse/NEAR AI topic API to error (mock 500 or invalid topic ID) and assert the UI surfaces the error alert with messaging referencing the failed fetch and a retry/back button.
- For a valid topic, verify the populated view includes:
  - Metadata rows (title, category, tags, status, posted by). Mention how the Discourse plugin provides the baseline data and how NEAR AI verification metadata is passed back via the summaries.
  - “View on Discourse” link pointing at the canonical Discourse topic (ensuring the link text + href align).
  - Reply count/age statistics and any badges (i.e., `replyStats` + `ageStats` component).
  - “Back to Proposals” button navigating to `/proposals`.

## Content Area: Summaries & Revisions
- Verify the main content toggles between collapsed/expanded text (e.g., clicking “Show more” expands the proposal body and updates the button label; “Show less” collapses). Confirm no corruption in trimmed text.
- Toggle each summary section (`proposalSummary`, `revisionSummary`, `discussionSummary`) and assert their contents load from `/api/proposals/<topic>/summaries` or `/api/discourse/topics/<topic>/summarize`, verifying that:
  - Loading indicators appear while the summaries fetch.
  - Mocked failure responses surface inline error messages plus retry controls.
  - Success cases show text plus verification proofs (if the mock returns `verification` metadata) with badges and proof ID/nonce info referencing NEAR AI.
- Open the revisions drawer:
  - Select different versions and assert the UI shows the correct diff highlights (toggle “Show diff highlights” if available) and display revision metadata.
  - Click “Summarize changes” to hit the versions-specific summary endpoint, ensuring the request includes the selected version numbers and the UI renders the returned summary text plus verification badges when present.

## Discussion Cards & Replies
- Expand each discussion card/reply thread and ensure replies render with expected metadata (author, timestamp, reaction counts). Expand/collapse toggles should maintain scroll positions.
- Trigger per-reply summaries:
  - Click the per-reply “Summarize” button to initiate `/api/discourse/replies/<id>/summaries` (or whichever route is used). Confirm loading states, handle mock errors (error toast or inline message), and verify success states display summary text plus verification badge when proof metadata exists.
  - For replies that have failed summary attempts, ensure retry is possible and the UI message indicates the failure.
- Mention that the Discourse plugin supplies the base discussion data while NEAR AI handles the summary creation and verification proofs.

## Sidebar Interactions
- Screening badge: when the topic returns a `screening` payload, assert the ScreeningBadge is visible with the correct status/context. Confirm that analytics emit a screening event (e.g., `proposal_screening_view`) when the badge renders or the screening panel opens.
- Screening button:
  - With a connected wallet (auth mocks enabling Better Auth + NEP-413 signatures), assert the ScreeningButton shows actionable states (e.g., “Screen”/“Publish”).
  - Without a wallet session, verify the sidebar instead shows the “Connect your NEAR wallet” prompt and the screening button is disabled or replaced.
  - Ensure clicking to screen/publish triggers the expected analytics event (e.g., `proposal_screening_submit`) and protects the path with auth gating so it cannot proceed without a wallet.

## Proposal Chatbot
- Expand/collapse the Proposal Chatbot sidebar component; confirm the expand/collapse icons change state.
- Send questions through the chatbot input and assert:
  - The request hits `/api/proposals/<topic>/summaries` or `/api/discourse/topics/<topic>/summaries` (depending on implementation) with the typed query.
  - Streaming responses render incrementally, and a NEAR AI verification error (mock streaming error) surfaces a user-facing error message.
  - Analytics events like `proposal_chatbot_summary_request` and `proposal_chatbot_*` tool invocations fire; verify by intercepting mock analytics calls.
  - Each bot reply optionally includes “tool calls” that invoke `/api/chat/completions` or `.discourse` endpoints, and the UI surfaces the called tool’s name + status.
- Test the chatbot’s “Summarize on demand” button, confirming it hits the correct summary endpoints, displays loading/error/success states, and includes verification badges when proof metadata exists.

## Verification & Analytics
- When NEAR AI summary responses include verification metadata, confirm the UI shows verification proof badges/IDs next to the relevant summary or reply, and mention that the NEAR AI flow propagates the verification context from the AI -> verification helper (proof/responses). Validate that the `verificationproof` link opens if available.
- Analytics coverage:
  - Summary request events (`proposal_summary_request`, `proposal_chatbot_summary_request`, etc.) fire when summary buttons are pushed.
  - Screening events occur when the ScreeningButton or ScreeningBadge actions occur.
  - Chatbot tool usage analytics (`proposal_chatbot_toolcall`) emit when tools are invoked.

## Auth Gating / Wallet States
- Without a wallet connection, ensure screening/publish controls remain disabled and a CTA to connect the NEAR wallet is visible. Buttons should open Better Auth flows when clicked.
- With a wallet connected (mocking WalletConnect/Better Auth), verify:
  - Screening/publish actions become available and hitting them sends the proper NEAR auth headers (e.g., `X-NEAR-AUTH`) to the backend.
  - Attempting to screen/publish without a wallet shows a “Please connect your wallet” message and no auth headers are sent.

## Summary
Capture a Playwright spec that documents all of the above interactions, referencing the NEAR AI/verification interplay, the Discourse plugin data source, screening flows, analytics events, and gating by wallet connection. Use the `seed.spec.ts` structure as a minimal template (mocks + `test` import) and build on it for this comprehensive scenario.
