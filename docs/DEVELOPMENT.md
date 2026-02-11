# Development Guide

This guide covers the development workflow, testing, linting, and CI/CD for the AI BD Team project.

## Table of Contents

- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Code Quality Tools](#code-quality-tools)
- [Testing](#testing)
- [CI/CD Pipeline](#cicd-pipeline)
- [Git Workflow](#git-workflow)

---

## Project Structure

```
ai-bd-team/
├── src/
│   ├── agents/              # Batch-mode agent implementations
│   ├── cli/                 # Unified CLI (commander.js)
│   ├── config/              # Configuration & environment validation
│   │   ├── env.ts           # Zod-validated environment variables
│   │   └── opportunity-filters.ts
│   ├── context/             # Company context loading
│   ├── conversation/        # Conversation analysis & engine
│   ├── coordination/        # Workflow orchestration, queues, triggers
│   ├── integrations/        # External service integrations
│   │   ├── database/        # Modular Supabase layer
│   │   │   ├── client.ts    # Supabase client singleton
│   │   │   ├── opportunities.ts
│   │   │   ├── agencies.ts
│   │   │   ├── companies.ts
│   │   │   ├── users.ts
│   │   │   ├── threads.ts
│   │   │   ├── queue.ts
│   │   │   ├── workflow.ts
│   │   │   └── ...
│   │   ├── claude.ts        # Anthropic Claude SDK
│   │   ├── sam-gov.ts       # SAM.gov API
│   │   ├── slack-*.ts       # Slack integrations
│   │   └── ...
│   ├── lib/                 # Shared utilities
│   │   └── logger.ts        # Pino structured logging
│   ├── live/                # Real-time Slack agent implementations
│   ├── prompts/             # System prompts for agents
│   ├── scripts/             # CLI scripts for batch operations
│   ├── services/            # Business logic services
│   ├── types/               # TypeScript type definitions
│   └── index.ts             # Main entry point
├── supabase/                # Database schema & migrations
├── docs/                    # Documentation
├── .github/workflows/       # CI/CD pipelines
├── vitest.config.ts         # Test configuration
├── eslint.config.js         # Linting rules
├── .prettierrc              # Formatting rules
└── tsconfig.json            # TypeScript configuration
```

### Key Modules

#### Database Layer (`src/integrations/database/`)

The database layer is split into domain-specific modules for maintainability:

| Module | Purpose |
|--------|---------|
| `client.ts` | Supabase client singleton |
| `opportunities.ts` | Opportunity CRUD operations |
| `agencies.ts` | Agency data |
| `companies.ts` | Company profiles |
| `users.ts` | User profiles & preferences |
| `threads.ts` | Conversation threads & summaries |
| `queue.ts` | Agent task queue |
| `workflow.ts` | Opportunity workflow state machine |
| `memory.ts` | Agent memory (short/long term) |
| `partners.ts` | Teaming partner data |

All modules are re-exported from `index.ts` for backwards compatibility:
```typescript
import { getOpportunity, getUserProfile } from './integrations/database/index.js';
// or
import { getOpportunity } from './integrations/supabase.js'; // legacy import still works
```

#### Logging (`src/lib/logger.ts`)

Structured logging using Pino:

```typescript
import { logger, createAgentLogger } from './lib/logger.js';

// Basic logging
logger.info('Application started');
logger.error({ err }, 'Operation failed');

// Agent-specific logger
const mayaLogger = createAgentLogger('maya');
mayaLogger.info({ opportunityId }, 'Found new opportunity');

// Job logger
const jobLogger = createJobLogger('daily-scan');
jobLogger.info('Scan complete');
```

**Development**: Pretty-printed, colorized output
**Production**: JSON format for log aggregation

---

## Development Setup

### Prerequisites

- Node.js 20+
- npm 9+
- Supabase account
- Slack workspace with bot tokens
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone <repository>
cd ai-bd-team

# Install dependencies (use --legacy-peer-deps for ESLint compatibility)
npm install --legacy-peer-deps

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Environment Variables

Environment variables are validated at startup using Zod. See `src/config/env.ts` for the schema.

Required variables:
- `SLACK_BOT_TOKEN` - Slack bot token
- `SLACK_APP_TOKEN` - Slack app token (for Socket Mode)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` or `SUPABASE_ANON_KEY` - Supabase auth
- `ANTHROPIC_API_KEY` - Claude API key

Optional integrations:
- `SAM_GOV_API_KEY` - SAM.gov API access
- `NOTION_TOKEN` - Notion integration
- `NEWS_API_KEY` - News search

---

## Code Quality Tools

### ESLint

Linting uses ESLint 9 with TypeScript support:

```bash
# Check for issues
npm run lint

# Auto-fix what can be fixed
npm run lint:fix
```

Configuration: `eslint.config.js`

Key rules:
- TypeScript strict mode
- Unused variables (warning, allows `_` prefix)
- No explicit `any` (warning)
- Prefer `const` over `let`
- Strict equality (`===`)

### Prettier

Code formatting:

```bash
# Format all files
npm run format

# Check formatting without changing
npm run format:check
```

Configuration: `.prettierrc`

Settings:
- Single quotes
- 2-space indentation
- 100 character line width
- Trailing commas

### Pre-commit Hooks

Husky + lint-staged runs on every commit:

1. **Prettier** formats staged `.ts` files
2. **ESLint** fixes staged `.ts` files

This ensures all committed code is properly formatted and linted.

---

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Structure

Tests are co-located with source code in `__tests__` directories:

```
src/
├── config/
│   └── __tests__/
│       └── env.test.ts
├── integrations/
│   └── database/
│       └── __tests__/
│           ├── setup.ts          # Mock utilities
│           ├── opportunities.test.ts
│           ├── queue.test.ts
│           ├── workflow.test.ts
│           ├── users.test.ts
│           └── threads.test.ts
└── lib/
    └── __tests__/
        └── logger.test.ts
```

### Writing Tests

Tests use Vitest with mocked Supabase:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testData } from './setup.js';

// Mock the Supabase client
vi.mock('../client.js', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

describe('myModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', async () => {
    const opportunity = testData.opportunity({ title: 'Test' });
    mockSingle.mockResolvedValue({ data: opportunity, error: null });

    const result = await getOpportunity('123');

    expect(result).toEqual(opportunity);
  });
});
```

### Test Data Factories

Use `testData` helpers from `setup.ts`:

```typescript
testData.opportunity({ status: 'new' })
testData.userProfile({ communication_style: 'concise' })
testData.workflow({ stage: 'researching' })
testData.queueItem({ agent: 'scout' })
```

### Coverage

Current coverage targets:
- `src/lib/logger.ts`: 100%
- `src/integrations/database/*.ts`: 70-100%
- `src/config/env.ts`: ~80%

Run `npm run test:coverage` to see the full report.

---

## CI/CD Pipeline

### GitHub Actions

On every push to `main` or `claude/*` branches:

#### CI Workflow (`.github/workflows/ci.yml`)

| Step | Command | Fails Build? |
|------|---------|--------------|
| Type Check | `npm run typecheck` | Yes |
| Lint | `npm run lint` | No (warnings only) |
| Tests | `npm test` | Yes |
| Build | `npm run build` | Yes |
| Format Check | `npm run format:check` | No (warnings only) |

#### Deploy Workflow (`.github/workflows/deploy.yml`)

Triggered on push to `main` after CI passes. Deploys to Railway.

### Local CI Check

Before pushing, you can run the full CI locally:

```bash
# Run all checks that would fail CI
npm run typecheck && npm test && npm run build

# Full check including lint/format
npm run typecheck && npm run lint && npm test && npm run build && npm run format:check
```

---

## Git Workflow

### Branching

- `main` - Production branch, deploys automatically
- `claude/*` - Feature branches (CI runs but no deploy)

### Commit Messages

Follow conventional commits:

```
<type>: <description>

[optional body]

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

Types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code restructuring
- `test:` - Adding/updating tests
- `chore:` - Maintenance tasks

### Pre-commit Checklist

Before committing:

1. ✅ `npm run typecheck` passes
2. ✅ `npm test` passes
3. ✅ `npm run lint` has 0 errors (warnings OK)
4. ✅ Code is formatted (auto-runs on commit)

---

## Unified CLI

The project includes a unified CLI for common operations:

```bash
# Run via npm
npm run cli -- <command>

# Available commands
npm run cli -- agent maya scan      # Run Maya scanner
npm run cli -- agent david research # Run David research
npm run cli -- live maya            # Start Maya in live mode
npm run cli -- workflow process     # Process workflow queue
npm run cli -- notion sync          # Sync with Notion
npm run cli -- cron daily           # Run daily cron jobs
```

See `src/cli/index.ts` for all available commands.

---

## Troubleshooting

### ESLint peer dependency errors

```bash
npm install --legacy-peer-deps
```

### Tests failing with type errors

Ensure test data uses proper union types:
```typescript
// Wrong
testData.opportunity({ status: 'invalid' })

// Correct - use valid OpportunityStatus
testData.opportunity({ status: 'new' })
```

### Environment validation fails

Check that all required environment variables are set. See `src/config/env.ts` for the full schema.

### Pre-commit hook fails

The hook runs Prettier and ESLint. Fix issues with:
```bash
npm run lint:fix
npm run format
```
