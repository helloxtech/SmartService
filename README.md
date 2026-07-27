# SmartService

SmartService is a reusable, tenant-isolated AI customer-service demonstration. P0 delivers the grounded text-service loop; P1 adds browser WebRTC voice; R11 ticket classification remains optional until P0 and P1 are accepted.

## Current state

Gate 0 is approved, Days 1–5 are fully validated locally, and Day 6 adds the browser/Worker/LiveKit Agent voice-session foundation. The public `/chat` path includes grounded bilingual answers, guardrails, handoff, polling, and finalization; `/voice` now implements explicit-click warming, Ready-gated microphone access, Chinese/English session selection, transcript display, and text fallback. The complete Day 5 checkpoint, three consecutive local P0 demos, and zero-cost Day 6 smoke passed; hosted-provider evidence remains pending. See [the live project status](docs/STATUS.md) for exact evidence and blockers.

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
pnpm fixtures:ingestion
pnpm verify:ingestion
pnpm verify:conversation
pnpm checkpoint:day4
pnpm checkpoint:day5
pnpm checkpoint:day6
```

`pnpm db:start` and `pnpm db:status` deliberately suppress generated local credentials. The fictional demo login values are generated into the ignored mode-`0600` `.env.local`; never paste or commit that file.

Use `pnpm dev:web` for the Vite shell and `pnpm dev:api` for the local Worker after the web build exists.

`pnpm verify:ingestion` requires a fresh local database (`pnpm db:reset` followed by `pnpm bootstrap:local`). It signs in through a real Chromium session, ingests the committed PDF, DOCX, and bounded URL fixtures, verifies Ready rows and enabled embeddings, exercises disable/enable, checks mobile overflow, and writes review screenshots under `/tmp`.

After ingestion succeeds, `pnpm verify:conversation` exercises all 12 fixed in-scope questions and all 8 fixed out-of-scope questions through the local Worker and Supabase. It verifies persisted citations, missing-knowledge gaps, handoff packages, scoped-token rejection, idempotency, and cursor/ETag polling.

`pnpm checkpoint:day4` resets and bootstraps the local database, runs the repository checks, browser and database tests, the six fixed guardrail evaluations, and the local guardrail/handoff/finalization smoke. It uses deterministic providers and makes no paid calls.

`pnpm checkpoint:day5` adds the fixed P0 evaluation and the exact dashboard/grouped-gap/manual-resolution/re-test smoke to the complete local checkpoint. `SMARTSERVICE_DEMO_CASE=diagnostic pnpm demo:p0:run` reproduces one clean-reset demo; `calibration` and `replacement` are the other fixed cases. See [the P0 demo script](docs/P0_DEMO_SCRIPT.md) and [the evaluation report](docs/P0_EVALUATION_REPORT.md) for recorded evidence.

`pnpm checkpoint:day6` validates the voice schema, short-lived token and internal Agent boundaries, browser warming/Ready/microphone-denial states, Nova-3 Agent configuration, final transcript persistence, and idempotent replay. The local path uses the explicit mock provider and makes no paid calls; live STT/WebRTC quality remains credential- and device-gated.

Local ingestion, chat, and Turnstile use explicit deterministic providers and make no paid calls. Hosted R2, Queue, Browser Run, Turnstile, Supabase, and OpenAI evidence is still required before G1; production refuses any mock provider mode.

## Gate records

Gate 0 approval and remaining hosted-provider requirements are in [the resource request](docs/RESOURCE_REQUEST.md). Provision secrets only in ignored local/provider secret stores. Never paste credentials into chat or commit `.env.local`.

The durable project state is in [docs/STATUS.md](docs/STATUS.md), and durable decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).
