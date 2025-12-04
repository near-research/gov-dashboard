## Project Overview
- NEAR Governance Dashboard web app that screens proposals and discussions, with NEP-413 wallet auth plus NEAR AI inference and verifiable compute checks.
- Built on Next.js 15 with TypeScript, Tailwind CSS, Radix UI components, Better Auth + hot-labs/near-connect for wallet linking, Drizzle ORM over PostgreSQL, and NEAR AI/verification helpers.

## Directory Structure
- `src/` – app code: `pages/` (Next routes + API handlers), `components/` (client components; auth flows, UI), `lib/` (auth, verification, near-ai helpers), `server/` (server logic), `utils/` (helpers), `fixtures/` and `types/`.
- `tests/` – `unit/` Vitest suites, `e2e/` Playwright specs, `fixtures/` for shared mock data, `vi-compat.ts` compatibility helpers.
- `drizzle/` – SQL migrations and metadata for PostgreSQL schema.
- `scripts/` – local utilities (DB connectivity/rate-limit checks).
- Root configs: `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`, `tailwind.config.js`, `postcss.config.js`, `bunfig.toml`, `railpack.toml`, `next.config.js`, `tsconfig.json`.
- Assets and generated artifacts: `public/`, `coverage/`, `test-results/`, `node_modules/`.

## Quick Reference
| Task | Command |
| --- | --- |
| Install deps | `bun install` |
| Dev server | `bun run dev` |
| Build / start | `bun run build` / `bun run start` |
| Lint | `bun run lint` |
| Unit tests (Vitest) | `bun run test` or `bun run test:unit` |
| Coverage | `bun run test:coverage` |
| Playwright E2E | `PLAYWRIGHT_TEST=true bun run test:e2e` |

| Key file | Purpose |
| --- | --- |
| `src/pages/api/auth/[...all].ts` | Better Auth proxy; keeps raw streams & multi-value headers. |
| `src/hooks/useNear.tsx` | Wallet connector lifecycle (hot-labs/near-connect). |
| `src/lib/auth/near-sign-in.ts` | Wallet SIWN retry/cancellation handling. |
| `src/lib/near-ai/client.ts` | NEAR AI client + timeout/retry helpers. |
| `src/config/near.ts` | Network, RPC, and EVM chain selection. |
| `test-setup.ts` | jsdom/jest-dom globals, module mock registry. |
| `tests/vi-compat.ts` | DOM/`vi.stubGlobal` fallback for non-jsdom runners. |

## Development Commands
- Install dependencies: `bun install` (package manager pinned via `bun.lock`; Node 18+). npm/yarn should work but Bun is the default.
- Start dev server: `bun run dev` (Next.js).
- Build for production: `bun run build`; start production server: `bun run start`.
- Lint: `bun run lint`.

## Testing
- Frameworks: Vitest (jsdom, globals enabled) with Testing Library + jest-dom; Playwright for E2E.
- Commands (non-watch): `bun run test` (all unit), `bun run test:unit` (scoped to `tests/unit`), `bun run test:coverage`, `bun run test:e2e` (Playwright).
- Conventions: unit files `*.test.{ts,tsx}` under `tests/unit/**`; E2E specs `*.spec.ts[x]` under `tests/e2e` (Playwright guarded by `PLAYWRIGHT_TEST=true`; Bun runner skips).
- Setup/mocks: `test-setup.ts` installs jsdom stubs, jest-dom, Testing Library cleanup, global `fetch`/`URL` helpers, module mock registry; `tests/vi-compat.ts` offers vi stub fallback and global DOM when runner lacks it. Module alias `@/*` resolves to `src`. Fixtures live in `tests/fixtures` and `src/fixtures` (e.g., verificationMocks). Common pattern uses `vi.mock`/`vi.fn` with handcrafted request/response shims (see `tests/unit/api/auth-all.test.ts`).
- Test data and mocking tips: prefer importing reusable fixtures from `tests/fixtures` (runtime-focused) or `src/fixtures` (shared app mocks). For API handler tests, emulate Node streams (e.g., `PassThrough`) and capture bodies via helper getters. Use the shared `__moduleMocks` map (wired in `test-setup.ts`) when stubbing modules with `vi.mock/doMock` to avoid leakage. When runners lack DOM globals, import `tests/vi-compat.ts` to stub `vi.stubGlobal` plus `URL.createObjectURL`/`fetch`.
### Vitest Patterns
- API handlers (`tests/unit/api/auth-all.test.ts`): `vi.mock` upstream handler, build `createReq`/`createRes` with `PassThrough`, store headers/body via `setHeader` + `getBody`, assert multi-value `Set-Cookie` arrays and propagated status/error types (`NearAITimeoutError`).
- DOM/clients: rely on jsdom from `test-setup.ts`; when running outside jsdom, import `tests/vi-compat.ts` for `vi.stubGlobal` + `URL.createObjectURL`/`fetch`.
- Fixtures: reuse `tests/fixtures/**` or `src/fixtures/**`; avoid live network/service calls.
### Playwright Patterns
- Specs are gated: execute only when `PLAYWRIGHT_TEST=true`, otherwise Bun/Vitest skip with console notice (`tests/e2e/verification.spec.ts`).
- Prefer `data-testid` queries (`verification-proof-trigger`) and `page.goto` URLs controlled by `PLAYWRIGHT_BASE_URL`; set `VERIFY_USE_MOCKS` inside tests when asserting mocked verification UI states.

## Code Conventions
- TypeScript-first with strict options; React function components, hooks for state/effects (`use client` on client components).
- Imports typically ordered external → aliased `@/...`; prefer path aliases over relative hops.
- File naming: kebab-case for modules/components (`near-sign-in-compact.tsx`, `retry.ts`), PascalCase for React component exports (`SignInForm`, `AuthProvider`); tests mirror subject with `.test.ts[x]`.
- Patterns: defensive optional chaining, small helper utilities (`retry.ts`), union types for result states, early returns in API handlers, explicit `try/catch` with toast-driven UX errors on the client; Next API handlers preserve streaming bodies and multi-value headers.

## NEAR Integration
- Wallet auth: Better Auth + `better-near-auth` SIWN plugin (`src/lib/auth.ts`, `src/lib/auth-client.ts`) using `siwnRecipient`/`siwnDomain` from `src/config/siwn.ts`; wallet linking via `@hot-labs/near-connect` orchestrated in `src/hooks/useNear.tsx` and retried by `nearSignInWithRetry`.
- Network config: `src/config/near.ts` picks `mainnet`/`testnet` from `NEXT_PUBLIC_NEAR_NETWORK` (fallback based on `NODE_ENV`), sets RPC URLs, social contract ID, and EVM WalletConnect chain metadata; warns on domain/network mismatch.
- WalletConnect: optional `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` enables WC metadata inside `useNear`.
- NEAR AI: `src/lib/near-ai/client.ts` wraps Cloud API with default base `https://cloud-api.near.ai`, env `NEAR_AI_CLOUD_API_KEY`, timeouts (2m) and exponential backoff; supports verification headers (`X-Verification-Id`, `X-Nonce`) and streaming via `chatCompletionsStream`.
- Verification: API routes (`src/pages/api/chat/completions.ts`, discourse/proposal summarize routes) hash requests/responses, call `extractVerificationMetadata`/`registerVerificationSession`, and surface `verification` payloads when present.

## Important Notes
- Environment: sample `.env.example` lists `NEAR_AI_CLOUD_API_KEY`, `DATABASE_URL`, Discourse settings, Better Auth secrets, NEAR recipient/domain/network, `NEXT_PUBLIC_BASE_URL`, etc.; auth routes expect these present. Playwright config honors `PLAYWRIGHT_PORT/BASE_URL/HOST/START_SERVER`, defaults to headless Chrome; `VERIFY_USE_MOCKS` defaults to `true` for tests.
- Discourse plugin-backed endpoints (`/api/discourse/search`, `/api/discourse/latest`, agent tools) clamp limits to 30 (render 20), default to the proposals category (`DISCOURSE_PROPOSALS_CATEGORY_ID`, 168), and honor `page` pagination; forward `userApiKey` when available for authenticated queries.
- Database: PostgreSQL schema managed via Drizzle (`drizzle-kit` scripts); migrations live in `drizzle/`.
- Auth: Better Auth + NEP-413 wallet flow via hot-labs/near-connect; `src/pages/api/auth/[...all].ts` proxies requests to `auth.handler` while streaming bodies and preserving `Set-Cookie`.
- Tooling: ESLint (Next core web vitals flat config), Tailwind + typography/animate plugins, PostCSS, Bun config present.
- Gotchas: Next API auth route disables body parsing to forward raw streams; tests rely on jsdom globals—ensure `test-setup.ts` runs (configured in `vitest.config.ts`). Playwright specs skip automatically unless `PLAYWRIGHT_TEST` set; Bun runner prints skip notice.

## Agent Rules
- Always Do: keep Next auth proxy streaming (no body parser), honor multi-value headers; load `test-setup.ts`/`tests/vi-compat.ts` for globals; prefer fixtures over live services; align network/domain via `src/config/near.ts`; pass verification IDs/nonces through NEAR AI calls.
- Never Do: enable body parsing on `src/pages/api/auth/[...all].ts`; hit real NEAR AI/Discourse endpoints in unit tests; run Playwright via Bun’s runner without `PLAYWRIGHT_TEST=true`; ignore `NEAR_AI_CLOUD_API_KEY`/SIWN env requirements when touching auth/AI paths.

## What Not To Do
- Do not bypass `test-setup.ts` or `tests/vi-compat.ts` when adding tests—missing DOM/mocks will cause flakiness.
- Avoid hitting real external services in unit tests; rely on fixtures (`tests/fixtures`, `src/fixtures/verificationMocks.ts`) and `vi.mock`.
- Don’t enable Next API body parsing on `src/pages/api/auth/[...all].ts`—it needs raw streams for auth proxying.
- Skip running Playwright specs with Bun’s built-in test runner; use `bun run test:e2e` (Playwright) with `PLAYWRIGHT_TEST=true`.
