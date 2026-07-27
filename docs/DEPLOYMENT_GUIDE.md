# SmartService Deployment Guide

## Release boundary

Release `0.10.0` is a two-week demonstrable prototype. Local deterministic deployment is complete and tested. No hosted or production deployment was performed because the required external credentials and final live-provider evidence are not available. Production data, production traffic, paid upgrades, and a public URL remain outside the current authorization.

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

Do not continue until the user provides the missing account access and authorizes the exact development deployment.

1. Create or select the dedicated development Supabase project in the approved North American west region.
2. Apply all ordered migrations with the Supabase CLI and run `pnpm db:test` plus `pnpm db:lint`.
3. Create the approved R2 bucket, ingestion/finalization Queues, and dead-letter Queues using the names in `apps/api/wrangler.jsonc`.
4. Configure Worker secrets by name from `.env.example`; use `wrangler secret put` or the Cloudflare dashboard. Never place values in tracked Wrangler variables.
5. Set `INGESTION_PROVIDER_MODE`, `CHAT_PROVIDER_MODE`, `AUXILIARY_PROVIDER_MODE`, `TURNSTILE_PROVIDER_MODE`, and `VOICE_PROVIDER_MODE` to `live` only after every corresponding binding is valid.
6. Build and deploy the Worker:

   ```bash
   pnpm check
   pnpm --filter @smartservice/api exec wrangler deploy
   ```

7. Configure the Agent's server-only LiveKit, Deepgram, ElevenLabs, and internal Worker values in its provider secret store.
8. Start or deploy the named Agent:

   ```bash
   pnpm --filter @smartservice/voice-agent start
   ```

9. Run the hosted P0 smoke, then the live P1 device/network matrix. Do not reuse local/mock results as hosted evidence.

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
