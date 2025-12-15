# NEAR Governance Dashboard

[neargov.ai](https://neargov.ai)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

Built on [NEAR AI](https://near.ai), this web application supports analysis of governance proposals and related forum discussions.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication-flow)
- [NEAR AI Cloud Models](#near-ai-cloud-models)
- [Resources](#resources)

## Features

### Proposal Review System

Results based on **6 Quality Criteria** and **2 Attention Scores**:

**Quality Criteria** (must pass all to succeed):

1. **Complete** - Proposal includes all the required template elements for a proposal of its type. For example, funding proposal includes budget and milestones.
2. **Legible** - Proposal content is clear enough that the decision being made can be unambiguously understood.
3. **Consistent** - Proposal does not contradict itself. Details such as budget, dates, and scope, are consistent everywhere they are referenced in the proposal contents.
4. **Compliant** - Proposal is compliant with all relevant rules/guidelines, such as the Constitution, HSP-001, and the Code of Conduct.
5. **Justified** - Proposal provides rationale that logically supports the stated objectives and actions. For example, the proposed solution reasonably addresses the problem and the proposal explains how.
6. **Measurable** - Proposal includes measurable outcomes and success criteria that can be evaluated.

**Attention Scores** (informational):

- **Relevant** - Proposal directly relates to the NEAR ecosystem. (high/medium/low)
- **Material** - Proposal has high potential impact and/or risks. (high/medium/low)

## Tech Stack

| Category           | Technology                   |
| ------------------ | ---------------------------- |
| **Framework**      | Next.js                      |
| **Language**       | TypeScript                   |
| **Database**       | PostgreSQL with Drizzle ORM  |
| **AI Provider**    | NEAR AI Cloud                |
| **NEAR Wallet**    | `better-near-auth`           |
| **Authentication** | `near-sign-verify` (NEP-413) |

## Quick Start

### Prerequisites

- **[Node.js](https://nodejs.org)** 18+ or **[Bun](https://bun.sh)**
- **[PostgreSQL](https://www.postgresql.org)** database
- **[NEAR Wallet](https://wallet.near.org)** (testnet or mainnet)
- **[NEAR AI Cloud API Key](https://cloud.near.ai)**

### Installation

```bash
# Download code from repository
git clone https://github.com/near-research/gov-dashboard.git

# Change directory
cd gov-dashboard

# Dependencies
bun install

# Copy .env template
cp .env.example .env
```

## Configuration

### Environment Variables

Create a `.env` based on `.env.example` and keep sensitive values out of source control. The dashboard relies on all of the following:

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/neargov` | Postgres connection string for storing screening results and running migrations. |
| `NEAR_AI_CLOUD_API_KEY` | `your_api_key_here` | NEAR AI Cloud key required for all evaluation/verification calls. Rotate when you rotate the API key. |
| `APP_BASE_URL` | `https://gov.near.org` | Trusted base URL used by server-side jobs, verification prefetch, and the plugin runtime. |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Client-side origin used by hooks and Playwright/Vitest tests; update for non-default hosts. |
| `NEXT_PUBLIC_NEAR_DOMAIN` | `gov.near.org` | Domain shown to users during SIWN; must match the wallet domain being used. |
| `NEXT_PUBLIC_NEAR_NETWORK` | `mainnet` | NEAR network for wallet connections; swap to `testnet` when testing against NEAR testnet. |
| `NEAR_RECIPIENT` | `gov.near` | SIWN recipient account; align with the domain/network above. |
| `BETTER_AUTH_SECRET` | (empty) | Secret issued by Better Auth; configure in production and keep the token string secret. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | URL where Better Auth payloads are parsed; point to your deployment host. |
| `DISCOURSE_URL` | `https://gov.near.org` | Root Discourse URL for fetching proposals/discussions. |
| `DISCOURSE_API_KEY` | (empty) | API key for the Discourse plugin runtime; required for authenticated requests. |
| `DISCOURSE_API_USERNAME` | (empty) | Discourse username tied to the above API key (often `system`). |
| `DISCOURSE_CLIENT_ID` | (empty) | Optional client ID used when overriding the Discourse plugin with `DISCOURSE_PLUGIN_URL`. |
| `DISCOURSE_PLUGIN_URL` | (empty) | Optional URL that points to a locally built plugin bundle for development or testing. |
| `NEXT_PUBLIC_HARNESS_MODE` | `auto` | Internal harness mode that mirrors the test fixture setup; leave as `auto` unless you are customizing the testing harness. |
| `VERIFY_USE_MOCKS` | `false` | Set to `true` to route verification/proof requests through fixtures instead of hitting live NEAR AI/verification services. |
| `DEBUG` | `false` | Set to `true` to enable verbose Bun/Next logs in production when debugging issues. |
| `TELEMETRY_ENABLED` | `true` | Enables telemetry collection; turn off in privacy-sensitive environments. |
| `TELEMETRY_DEBUG` | `false` | Prints telemetry events to the console during local development. |
| `VERIFICATION_SERVICE_TOKEN` | (empty) | Optional bearer-free token used by `/api/verification/proof` to skip wallet auth when prefetching. |
| `INTEL_TDX_ATTESTATION_URL` | (empty) | Intel TDX verifier endpoint; set alongside `INTEL_TDX_API_KEY` to enable attestation flows. |
| `INTEL_TDX_API_KEY` | (empty) | API key used to sign Intel TDX attestation requests. |

### Verification & Attestation

- `NEAR_AI_CLOUD_API_KEY`: Required for all NEAR AI Cloud interactions (already listed above).
- `INTEL_TDX_ATTESTATION_URL` / `INTEL_TDX_API_KEY`: Required when Intel TDX verification is enabled (attestation proof pages, agents). Both values must be configured together and point at your Intel attestation verifier endpoint.
- `VERIFICATION_SERVICE_TOKEN` (optional): When set, the server-side prefetcher includes this bearer-free token so `/api/verification/proof` can skip wallet auth. In development, the prefetch call also sets `x-verification-prefetch: true` allowing the handler to bypass authentication even if no token is configured.

### Database Setup

1. Create PostgreSQL database:

```bash
createdb neargov
```

2. Run migrations:

```bash
# Using provided migration file
psql neargov < migration.sql

# Or generate from schema
bun run db:push
```

3. Test connection:

```bash
bun run scripts/test-db.ts
```

## Development

```bash
# Start development server
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

Visit [http://localhost:3000](http://localhost:3000)

## Database Schema

### `screening_results` Table

Primary table for storing proposal evaluations.

| Column               | Type         | Description                        |
| -------------------- | ------------ | ---------------------------------- |
| `topic_id`           | VARCHAR(255) | Discourse topic ID                 |
| `revision_number`    | INTEGER      | Version number of proposal         |
| `evaluation`         | JSONB        | Full AI evaluation results         |
| `title`              | TEXT         | Proposal title                     |
| `near_account`       | VARCHAR(255) | Evaluator's NEAR account           |
| `timestamp`          | TIMESTAMP    | When screening was performed       |
| `revision_timestamp` | TIMESTAMP    | When revision was created          |
| `quality_score`      | REAL         | Computed quality score (0.0-1.0)   |
| `attention_score`    | REAL         | Computed attention score (0.0-1.0) |

**Primary Key:** `(topic_id, revision_number)` - Prevents duplicate screenings

**Indexes:**

- `topic_id` - Query all revisions of a proposal
- `near_account` - Filter by evaluator
- `timestamp DESC` - Sort by newest first
- `quality_score` - Filter/sort by quality
- `attention_score` - Filter/sort by attention
- JSON indexes on `overallPass`, `relevant`, `material`

### Evaluation JSONB Structure

```typescript
{
  // Quality criteria (6 total)
  complete: { pass: boolean, reason: string },
  legible: { pass: boolean, reason: string },
  consistent: { pass: boolean, reason: string },
  compliant: { pass: boolean, reason: string },
  justified: { pass: boolean, reason: string },
  measurable: { pass: boolean, reason: string },

  // Attention scores (2 total)
  relevant: { score: "high" | "medium" | "low", reason: string },
  material: { score: "high" | "medium" | "low", reason: string },

  // Computed values
  qualityScore: number,      // 0.0-1.0
  attentionScore: number,    // 0.0-1.0
  overallPass: boolean,      // true if ALL quality criteria pass
  summary: string            // 3-sentence summary
}
```

## API Endpoints

### Plugins

- **Discourse plugin** – loaded via `every-plugin` Module Federation runtime with `DISCOURSE_API_KEY` secret and `DISCOURSE_URL`/`DISCOURSE_API_USERNAME`/`DISCOURSE_CLIENT_ID` variables. Runtime setup lives in `src/lib/router.ts` and `src/server/plugins/discourse.ts` using `createPluginRuntime` per the “Using Plugins” guide. Types are augmented in `src/types/every-plugin.d.ts` to keep `usePlugin("discourse-plugin")` strongly typed.
- **`every-plugin` framework** – The runtime loads and executes Discourse API calls using Module Federation. See the typed contract in `discourse-plugin/index.d.ts`, runtime wiring in `src/lib/router.ts` and `src/server/plugins/discourse.ts`, and override the remote with `DISCOURSE_PLUGIN_URL` if you host your own build.

### Local Plugin Development

When you want to run plugins directly (for monorepo dev, CI, or tests) without Module Federation noise, use `createLocalPluginRuntime` from `every-plugin/testing`. Define your local implementations, map them with `as const`, and the helper infers the plugin IDs, procedures, and config typings for you.

```typescript
import { createLocalPluginRuntime } from "every-plugin/testing";
import DataSource from "./plugins/data-source";
import Transformer from "./plugins/transformer";

const pluginMap = {
  "data-source": DataSource,
  transformer: Transformer,
} as const;

const runtime = createLocalPluginRuntime(
  {
    registry: {
      "data-source": {
        remoteUrl: "http://localhost:3000/remoteEntry.js",
        version: "1.0.0",
      },
      transformer: {
        remoteUrl: "http://localhost:3001/remoteEntry.js",
        version: "1.0.0",
      },
    },
    secrets: { API_KEY: "dev-key" },
  },
  pluginMap
);

const { client } = await runtime.usePlugin("data-source", {
  secrets: { apiKey: "{{API_KEY}}" },
  variables: { timeout: 30_000 },
});

const result = await client.getData({ id: "123" });
```

**Why it helps**

- **Automatic typing** – `as const` gives IDE autocomplete for plugin IDs, procedures, and configs without manual bindings.
- **Local-first workflows** – Use the same code paths for monorepo dev, unit/integration testing, and CI before switching to remote CDN entries in prod.

**Recommended workflow**

1. Implement your local plugin (`plugins/my-plugin/src/index.ts`) with `createPlugin`.
2. Build a `pluginMap` for `createLocalPluginRuntime` in your dev server or tests.
3. Call `runtime.usePlugin()` just like the dist/runtime interface; secrets/variables are resolved via templates like `{{API_KEY}}`.
4. When you’re ready for production, swap to `createPluginRuntime` with remote URLs while keeping the same client calls.

By centralizing this pattern you stay compliant with the macOS host restriction and avoid multi-host Module Federation headaches during local development.

### Proposal Management

| Endpoint                                  | Method | Auth | Description            |
| ----------------------------------------- | ------ | ---- | ---------------------- |
| `/api/proposals/[id]`                     | GET    | No   | Get proposal details   |
| `/api/proposals/[id]/summarize`           | POST   | No   | AI summary of proposal |
| `/api/proposals/[id]/revisions`           | GET    | No   | Get all revisions      |
| `/api/proposals/[id]/revisions/summarize` | POST   | No   | AI summary of changes  |

### Discourse Integration

| Endpoint                                        | Method | Auth | Description                        |
| ----------------------------------------------- | ------ | ---- | ---------------------------------- |
| `/api/discourse/latest`                         | GET    | No   | Get latest proposals from category |
| `/api/discourse/posts`                          | GET    | No   | Get all posts from Discourse       |
| `/api/discourse/posts/[id]/revisions`           | GET    | No   | Get post revisions                 |
| `/api/discourse/posts/[id]/revisions/summarize` | POST   | No   | AI summary of post changes         |
| `/api/discourse/topics/[id]/summarize`          | POST   | No   | AI discussion summary              |
| `/api/discourse/replies/[id]/summarize`         | POST   | No   | AI reply summary                   |

### Screening

| Endpoint                      | Method | Auth | Description               |
| ----------------------------- | ------ | ---- | ------------------------- |
| `/api/screen`                 | POST   | Yes  | Screen proposal (no save) |
| `/api/saveAnalysis/[topicId]` | POST   | Yes  | Screen & save to DB       |
| `/api/getAnalysis/[topicId]`  | GET    | No   | Get screening results     |

### AI Chat

| Endpoint                | Method | Auth | Description         |
| ----------------------- | ------ | ---- | ------------------- |
| `/api/chat/completions` | POST   | No   | NEAR AI Cloud proxy |
| `/api/agent`            | POST   | No   | Agent with tools    |

## Authentication Flow

The platform uses NEP-413 wallet signatures for authentication:

1. **Connect Wallet** - User connects NEAR wallet
2. **Sign Message** - User signs message: `"Screen proposal {topicId}"`
3. **Verify Signature** - Server validates using `near-sign-verify`
4. **Authorized Request** - Include `Authorization: Bearer <token>` header

### Example Usage

```typescript
// Client-side signing
const signature = await wallet.signMessage({
  message: `Screen proposal ${topicId}`,
  recipient: "social.near",
});

// API request
const response = await fetch(`/api/saveAnalysis/${topicId}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${signature}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ title, content, revisionNumber }),
});
```

### Rate Limiting

Each API endpoint enforces an in-memory quota:

- Default: 5 requests per endpoint within 15 minutes
- Counted per NEAR account if connected, or per IP if anonymous
- If exceeded, returns `429 Too Many Requests` with `Retry-After`
- Responses include `X-RateLimit-Remaining`, `X-RateLimit-Limit`, and `X-RateLimit-Reset`

## Caching Strategy

AI-generated summaries are cached to improve performance and reduce costs:

| Content Type | TTL    | Cache Key                     |
| ------------ | ------ | ----------------------------- |
| Proposal     | 60 min | `proposal:{topicId}`          |
| Revisions    | 15 min | `proposal:revision:{topicId}` |
| Discussion   | 5 min  | `topic:discussion:{topicId}`  |
| Reply        | 30 min | `reply:{replyId}`             |

Caches are in-memory and reset on server restart.

## NEAR AI Cloud Models

Provides three AI models, all hosted in GPU TEEs (Trusted Execution Environments) with end-to-end encryption and verifiable inference.

### Available Models

| Model             | Context | Pricing                  |
| ----------------- | ------- | ------------------------ |
| **DeepSeek V3.1** | 128K    | $1/$2.5 per M tokens     |
| **GPT OSS 120B**  | 131K    | $0.2/$0.6 per M tokens   |
| **Qwen3 30B**     | 262K    | $0.15/$0.45 per M tokens |

### Model Details

**DeepSeek:** `deepseek-ai/DeepSeek-V3.1`

- Hybrid thinking/non-thinking modes via chat templates
- Optimized for tool usage and agent tasks
- Faster thinking compared to previous versions

**OpenAI:** `openai/gpt-oss-120b`

- 117B parameters (MoE), 5.1B active per forward pass
- Configurable reasoning depth with chain-of-thought access
- Optimized for single H100 GPU with MXFP4 quantization
- Native tool use: function calling, browsing, structured outputs

**Qwen:** `Qwen/Qwen3-30B-A3B-Instruct-2507`

- 30.5B total parameters, 3.3B activated per inference
- Ultra-long 262K context window
- Non-thinking mode only
- Strong multilingual and coding capabilities

## License

MIT ~ see [LICENSE](LICENSE) file for details

## Resources

- [NEAR AI Cloud Documentation](https://docs.near.ai/cloud)
- [NEP-413 Specification](https://github.com/near/NEPs/blob/master/neps/nep-0413.md)
- [NEAR Governance Forum](https://gov.near.org)

## Contributing

Your help would be much appreciated!

### Development Workflow

1. Fork the repository
2. Create a new branch (`git checkout -b update`)
3. Commit your changes (`git commit -m 'message'`)
4. Push to the branch (`git push origin update`)
5. Open a Pull Request

## Support

- [GitHub Issues](https://github.com/near-research/gov-dashboard/issues)
