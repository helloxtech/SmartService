# SmartService

SmartService is a reusable, tenant-isolated AI customer-service demonstration. P0 delivers the grounded text-service loop; P1 adds browser WebRTC voice; R11 ticket classification remains optional until P0 and P1 are accepted.

## Current state

Gate 0 is approved. The Day 1 foundation is complete: the pnpm workspace, React authentication shell, Hono Worker, ordered Supabase migrations, local fictional identities, forced tenant RLS, and validation toolchain are operational. Day 2 knowledge ingestion is next. See [the live project status](docs/STATUS.md) for exact evidence and blockers.

## Locked delivery

- P0: PDF, DOCX, and bounded same-origin website ingestion; cited Chinese and English text answers; refusal and handoff; guardrails; agent workspace; conversation finalization; dashboard and knowledge-gap resolution.
- P1: browser microphone and LiveKit WebRTC; Deepgram Nova-3 STT; shared RAG and guardrails; ElevenLabs Flash v2.5 TTS; interruption handling; honest P50/P95 latency evidence.
- Optional R11: internal ticket classification and list only after P0 and P1 acceptance and the documented entry conditions are met.

The implementation uses React/Vite/TypeScript, Cloudflare Workers/Hono/Queues/R2/Browser Run, Supabase Auth/PostgreSQL/RLS/pgvector, OpenAI Responses API, LiveKit Agents, Deepgram, ElevenLabs, Vitest, and Playwright. See [the Codex execution entry](docs/spec/00_CODEX_START_HERE.md) for the controlling specification.

## Repository identity

- Product: `SmartService`
- Package/repository slug: `smartservice`
- Cloud resource prefix: `smartservice-*`
- Git remote: `https://github.com/helloxtech/SmartService.git`

Historical source PDFs retain their original titles.

## Local foundation

```bash
pnpm install
pnpm db:start
pnpm db:reset
pnpm bootstrap:local
pnpm verify:local-access
pnpm check
pnpm test:e2e
pnpm db:test
pnpm db:lint
```

`pnpm db:start` and `pnpm db:status` deliberately suppress generated local credentials. The fictional demo login values are generated into the ignored mode-`0600` `.env.local`; never paste or commit that file.

Use `pnpm dev:web` for the Vite shell and `pnpm dev:api` for the local Worker after the web build exists.

## Gate records

Gate 0 approval and remaining hosted-provider requirements are in [the resource request](docs/RESOURCE_REQUEST.md). Provision secrets only in ignored local/provider secret stores. Never paste credentials into chat or commit `.env.local`.

The durable project state is in [docs/STATUS.md](docs/STATUS.md), and durable decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).
