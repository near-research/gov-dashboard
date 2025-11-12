# NEAR Governance Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

[neargov.ai](https://neargov.ai)

> Built on [NEAR AI](https://near.ai), this open web application supports analysis of governance proposals based on the necessary context.

---

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
| **NEAR Wallet**    | `@hot-labs/near-connect`     |
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
git clone https://github.com/near-research/gov.git

# Change directory
cd gov

# Dependencies
bun install

# Copy .env template
cp .env.example .env
```

## Configuration

### Environment Variables

Create `.env` file with:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/neargov
NEAR_AI_CLOUD_API_KEY=your_api_key_here
```

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
bun run src/lib/scripts/test-db.ts
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

Simple in-memory rate limiter by NEAR account:

- 5 requests per 15 minutes
- Separate limit per account
- Returns `429 Too Many Requests` with `Retry-After` header

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

## Project Structure

```
gov/
├── src/
│   ├── components/          # React components
│   │   ├── chat/           # Chatbot UI
│   │   ├── nav/            # Navigation
│   │   ├── proposal/       # Proposal components
│   │   └── ui/             # Radix UI components
│   ├── hooks/              # React hooks
│   │   └── useNear.ts      # NEAR wallet hook
│   ├── lib/
│   │   ├── db/             # Database layer
│   │   │   ├── schema.ts   # Drizzle schema
│   │   │   ├── queries.ts  # Query helpers
│   │   │   └── index.ts    # DB connection
│   │   ├── prompts/        # AI prompt templates
│   │   ├── server/         # Server utilities
│   │   │   └── screening.ts # Auth & screening logic
│   │   ├── scripts/        # CLI scripts
│   │   └── utils/          # Utility functions
│   ├── pages/
│   │   ├── api/            # API routes
│   │   │   ├── proposals/  # Proposal endpoints
│   │   │   ├── discourse/  # Discourse integration
│   │   │   ├── saveAnalysis/ # Screening endpoints
│   │   │   ├── getAnalysis/  # Query endpoints
│   │   │   ├── screen.ts   # Screen without saving
│   │   │   ├── agent.ts    # AI agent with tools
│   │   │   └── chat/       # Chat completions
│   │   ├── proposals/      # Proposal pages
│   │   │   ├── [id].tsx    # Proposal detail
│   │   │   └── new.tsx     # Create proposal
│   │   ├── chat.tsx        # Chat interface
│   │   ├── index.tsx       # Homepage
│   │   └── _app.tsx        # App wrapper
│   ├── styles/             # Global CSS
│   └── types/              # TypeScript types
├── public/                 # Static assets
├── migration.sql           # Database migration
└── package.json
```

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

- [GitHub Issues](https://github.com/near-research/gov/issues)
