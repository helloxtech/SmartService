# SmartService Deployment Guide

## Release boundary

Release `0.10.0` is a two-week demonstrable prototype. Local deterministic deployment is complete and tested. Hosted DEV is available at `https://smartservice-dev.hurryupgo-b2d.workers.dev` for mock-provider smoke testing. Production data, production traffic, paid upgrades, live G1/G2 acceptance, and a public production URL remain outside the current authorization until their gates are explicitly cleared.

## Runtime topology

- One Cloudflare Worker serves the built React application and Hono API from the same origin.
- Cloudflare R2 stores knowledge files; Queues run ingestion and finalization jobs.
- Supabase provides Auth, PostgreSQL, RLS, pgvector, and tenant data.
- A separate named LiveKit Node Agent uses Deepgram Nova-3, the shared Worker RAG/guardrail path, and ElevenLabs Flash v2.5.
- Browser customers receive short-lived conversation and LiveKit room tokens. Provider secrets remain server-side.

## Local UAT deployment

Prerequisites are Node 24+, pnpm 11+, Docker/Colima, Supabase CLI, and Chromium.

```bash
pnpm install
pnpm uat:prepare
pnpm dev:api
```

Open:

- Customer text: `http://127.0.0.1:8787/chat`
- Customer voice lifecycle: `http://127.0.0.1:8787/voice`
- Team workspace: `http://127.0.0.1:8787/app/inbox`
- Dashboard: `http://127.0.0.1:8787/app/dashboard`

The fictional Admin and Agent credentials are stored only under the `DEMO_ADMIN_*` and `DEMO_AGENT_*` names in ignored `.env.local`. Never display, paste, or commit their values.

Local voice uses the explicit mock room provider and does not synthesize real provider audio. It is valid for UI, state, guardrail, handoff, and failure-path UAT, but not microphone/STT/TTS quality or G2 latency acceptance.

## Hosted development deployment

The correct browser-created online Supabase project, Cloudflare DEV R2/Queue resources, and `smartservice-dev` Worker now exist. The hosted DEV preview is usable for smoke testing in mock-provider mode, with fictional fixture knowledge seeded by `pnpm hosted:seed-demo-knowledge`. Live G1 still requires live Turnstile, R2 signer, Browser Run, and live chat/ingestion provider configuration.

1. Store the dedicated Supabase project URL, browser publishable key, service-role key, and database migration credential only in ignored local/provider secret storage.
2. Apply all ordered migrations to the dedicated project and run `pnpm db:test` plus `pnpm db:lint` against that hosted schema. Connector-applied migrations are useful progress, but the final evidence still needs a repeatable migration status.
3. Confirm the approved R2 buckets, ingestion/finalization Queues, and dead-letter Queues using the names in `apps/api/wrangler.jsonc`.
4. Configure Worker secrets by name from `.env.example`; use `wrangler secret put` or the Cloudflare dashboard. Never place values in tracked Wrangler variables.
5. Set `INGESTION_PROVIDER_MODE`, `CHAT_PROVIDER_MODE`, `AUXILIARY_PROVIDER_MODE`, `TURNSTILE_PROVIDER_MODE`, and `VOICE_PROVIDER_MODE` to `live` only after every corresponding binding is valid.
6. Build and deploy the Worker:

   ```bash
   pnpm check
   pnpm --filter @smartservice/api exec wrangler deploy
   ```

7. Configure Cloudflare native Workers Builds or equivalent Git CI/CD so `helloxtech/SmartService.git` pushes deploy the same `apps/api/wrangler.jsonc` Worker. The Worker name in Cloudflare must remain `smartservice-dev`, matching the Wrangler configuration. DEV is connected to `helloxtech/SmartService` on `main`, and the Git-triggered deployment path has been verified.
8. Configure the Agent's server-only LiveKit, Deepgram, ElevenLabs, and internal Worker values in its provider secret store.
9. Start or deploy the named Agent:

   ```bash
   pnpm --filter @smartservice/voice-agent start
   ```

10. Run the hosted P0 smoke, then the live P1 device/network matrix. Do not reuse local/mock results as hosted evidence.

## Hosted DEV provisioning checkpoint

Completed:

- Wrong connector-created Supabase project `wfkheempcfislbaonkiz` is inactive; true deletion requires that account's CLI/API token.
- Correct browser-created Supabase `SmartService` project `ibuvpregltbvxsxhivrg` exists in `us-west-2`, is healthy, has all 10 migrations applied, is seeded, and has hosted demo identities verified.
- Cloudflare R2 buckets exist: `smartservice-knowledge-dev` and `smartservice-knowledge-preview`.
- Cloudflare Queues exist: `smartservice-ingest-dev`, `smartservice-finalize-dev`, `smartservice-ingest-dlq-dev`, and `smartservice-finalize-dlq-dev`.
- `smartservice-dev` is deployed at `https://smartservice-dev.hurryupgo-b2d.workers.dev`; `/health`, hosted Admin login, public conversation creation, and public message smoke passed in DEV/mock-provider mode.
- The user-signed Supabase browser account can access the correct `SmartService` project `ibuvpregltbvxsxhivrg`. The Supabase connector account is different and sees only the inactive wrong project `wfkheempcfislbaonkiz`, so it is not the authority for this hosted DEV environment.
- Cloudflare native Workers Builds is connected to `helloxtech/SmartService` with production branch `main`; pushes to `main` have triggered Cloudflare Worker deployments, and the local branch has been verified clean/aligned with `origin/main`. Use `pnpm --filter @smartservice/api exec wrangler deployments list --name smartservice-dev` for the current version ID because every pushed documentation change can create a newer Worker version.
- Hosted fictional NovaFlow knowledge was seeded through the shared deterministic ingestion pipeline: 3 Ready sources and 23 embedded chunks.
- `pnpm verify:hosted-dev` passed hosted routes, health, ready knowledge, 2/2 cited answers, and 1/1 safe handoff.

Still required:

- Add Browser Run, R2 signer, and live Turnstile credentials before switching provider modes to live and claiming hosted G1.
- Hosted live G1 smoke evidence with live provider modes.

## Live verification gates

Before G1, retain the deployed URL, commit SHA, migration identity, provider modes, 12/12 in-scope and 8/8 unsupported results, 6/6 guardrails, cross-tenant denial, costs, and known limitations.

Before G2, additionally retain:

- LiveKit Agent version and all provider regions.
- Browser, OS, device, microphone/headset, and network metadata.
- At least 40 warm turns with 20 Chinese and 20 English.
- Raw browser playback timestamps, failures, warming/cold starts, P50/P95/max, interruption traces, and false-interruption results.
- Three complete live demo runs with no Blocker/Critical defect.

## Rollback and recovery

- Application rollback: redeploy the prior verified Git tag and matching Worker assets.
- Agent rollback: redeploy the Agent version paired with that application tag.
- Database rollback: do not reverse destructive migrations in place. Restore the approved development backup or apply a reviewed forward migration.
- Knowledge failure: keep the previous active source version; retry through the existing idempotent ingestion action.
- Provider failure: leave live mode fail-closed, show the text fallback, and retain stable error codes. Never switch a public deployment to mock mode.
- Secret exposure: revoke the provider credential immediately, rotate it in the provider store, and redeploy without logging the replacement.

## Production note

This release is not approved for production. A production launch requires a separate security, privacy, retention, capacity, observability, cost, and operational review.
