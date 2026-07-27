# SmartService

SmartService is a reusable, tenant-isolated AI customer-service demonstration. P0 delivers the grounded text-service loop; P1 adds browser WebRTC voice; R11 ticket classification remains optional until P0 and P1 are accepted.

## Current state

The repository is at Gate 0: resource and readiness review. No product functionality has been implemented. Product work must not begin until Forrest Zhang explicitly approves Gate 0.

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

## Gate 0

Review [the resource request](docs/RESOURCE_REQUEST.md), provision secrets only in ignored local/provider secret stores, and then explicitly approve Gate 0. Never paste credentials into chat or commit `.env.local`.

The durable project state is in [docs/STATUS.md](docs/STATUS.md), and durable decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).
