# Playwright End-to-End Toolkit

This directory hosts the Playwright specs that exercise the core NEAR Governance flows after the hug refactor. The suite is gated by `PLAYWRIGHT_TEST=true` so it only runs when explicitly enabled.

## Running locally

1. Start the app (if not already running): `bun run dev`.
2. Run the Playwright suite with Bun:
   ```bash
   PLAYWRIGHT_TEST=true bun run test:e2e --project=chromium --workers=1
   ```
   - Adjust `--project` if you need Firefox/WebKit coverage.
   - Supply `PLAYWRIGHT_BASE_URL`/`PLAYWRIGHT_PORT` when targeting a custom host.
3. The tests rely on `tests/e2e/helpers/playwright-mocks.ts` to stub NEAR AI Cloud, verification proof, and Discourse endpoints so they remain offline-safe.

## What is covered

- **Login** (`/login`): verifies the HOT wallet harness connects, exposes the sign-in CTA, and allows disconnection without touching Better Auth APIs.
- **Proposals** (`/proposals`): ensures the proposals list renders cards driven by a mocked Discourse latest-post response.
- **Playwright flows** (`/playwright/*` + the home page `/`): exercises the screening form, discussion/reply summarization motifs, and the agent/chatbot interaction using SSE mocks for `/api/chat/completions`, `/api/agent`, and proof fetching.

## Next steps for CI

1. **Install dependencies**: invoke `bun install` (or `npm ci`) as part of the setup step.
2. **Start the dev server**: reuse `bun run dev -- --hostname 127.0.0.1 --port 4000` (matching `playwright.config.ts`). Use the `playwright` config `webServer` block or start the server manually before the tests.
3. **Run the suite**: execute `PLAYWRIGHT_TEST=true bun run test:e2e --project=chromium --workers=1` to ensure the harness-only specs run. Export `PLAYWRIGHT_BASE_URL` when the app is served on a non-default host.
4. **Artifacts and reporting**: leverage `playwright show-report` or `npx playwright show-report` to expose HTML results, and archive `playwright-report/` or `test-results/` for visibility.

A sample GitHub Actions job would:

- Use the official Bun image or Node 18+.
- Run `bun install`.
- Start the dev server in the background (or rely on Playwright's `webServer`).
- Run the Playwright command above with `PLAYWRIGHT_TEST=true`.
- Upload the generated Playwright report as a workflow artifact.
