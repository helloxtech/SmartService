# SmartService Gate 0 Resource Request

**Last audited:** July 26, 2026
**Secret values stored here:** None
**Current decision:** No product implementation may begin until Forrest Zhang explicitly approves Gate 0.

## Status and priority

Status values:

- `MISSING`: not present or not approved.
- `READY`: verified without exposing a secret.
- `VERIFY`: expected to exist but still needs a non-destructive check.
- `DEFERRED`: intentionally postponed to its documented gate.
- `NOT-NEEDED`: excluded by scope or replaced by an approved mock/default.

Priority values:

- `BLOCKING-NOW`: required to approve Gate 0 and start implementation.
- `BLOCKING-P0`: required for a live P0 integration and G1 acceptance.
- `BLOCKING-P1`: required before the P1 voice slice and G2 acceptance.
- `OPTIONAL`: not on the critical path and requires separate approval if billable.
- `CAN-MOCK`: may use a deterministic mock during routine development, but the stated live gate still applies.

## Secret-handling rules

- Never paste credentials into Codex chat, documentation, source code, Git commits, issue text, or test output.
- Put local values in the ignored root `.env.local`. Provider-specific ignored files may be used where the implementation documents them.
- Put deployed Worker secrets in Cloudflare with `wrangler secret put <NAME>`.
- Put LiveKit Agent deployment secrets in the LiveKit secret store.
- Keep Supabase service-role, database, OpenAI, LiveKit API secret, Deepgram, ElevenLabs, conversation-signing, and internal-service credentials server-side.
- Browser-safe values are still configuration, not authorization. Supabase browser access remains protected by RLS.
- Treat every signed R2 URL as a short-lived bearer credential: never log its query string or retain it after the operation.
- Verification reports only success, failure category, account/project identity, and safe quota metadata; it never prints a secret or full authorization header.

## Audited readiness snapshot

| Item | Priority | Status | Evidence or remaining action |
|---|---|---:|---|
| Repository identity | BLOCKING-NOW | READY | Product `SmartService`; slug `smartservice`; resource prefix `smartservice-*` |
| Local Git repository | BLOCKING-NOW | READY | Initialized on `main` |
| Git remote | BLOCKING-NOW | READY | `origin` is `https://github.com/helloxtech/SmartService.git`; read-only `ls-remote` succeeded and returned no branch refs |
| Git author identity | BLOCKING-NOW | READY | Repository-local identity matches the existing `helloxtech` repository convention |
| GitHub push authorization | BLOCKING-NOW | MISSING | Explicitly authorize the initial push after reviewing the baseline commit |
| GitHub CLI | OPTIONAL | NOT-NEEDED | `gh` is absent; Git itself can fetch and push |
| Node.js | BLOCKING-NOW | READY | `v24.16.0` |
| pnpm | BLOCKING-NOW | READY | `11.9.0` |
| Git | BLOCKING-NOW | READY | `2.50.1` |
| Supabase CLI | BLOCKING-P0 | READY | `2.109.1` |
| Docker engine | BLOCKING-P0 | READY | Client `29.6.1`; daemon `29.5.2` |
| Wrangler | BLOCKING-P0 | READY | `4.114.0` is runnable through the package runner; add it as a pinned workspace dev dependency on Day 1 |
| macOS | BLOCKING-NOW | READY | macOS `26.5.1`, Apple silicon |
| Supported browsers | BLOCKING-P1 | READY | Chrome, Edge, and Safari are installed |
| Microphone/headset and browser permission | BLOCKING-P1 | VERIFY | Must be tested interactively on the final demo device |
| Local secret file | BLOCKING-NOW | MISSING | `.env.local` does not exist; all audited provider environment names are unset |
| Product/provider code | BLOCKING-NOW | NOT-NEEDED | Correctly absent during Gate 0 |
| Cost-bearing project provider calls | BLOCKING-NOW | READY | None made; recorded project cost is USD 0 |

## BLOCKING-NOW

These are the only decisions and actions that prevent Gate 0 approval and implementation from starting.

| Resource or approval | Status | Exact non-secret action |
|---|---:|---|
| Explicit Gate 0 approval | MISSING | Review this file and reply with an explicit `Gate 0 approved` statement after the other `BLOCKING-NOW` items are resolved |
| Local secret container | MISSING | Run `cp .env.example .env.local`, then fill values locally; do not paste the file or values into chat |
| Total live-provider development budget | MISSING | Approve a USD cap. Proposed default: **USD 50 total**, no paid plan or subscription change without separate approval |
| Resource-creation authority | MISSING | Approve or deny Codex creating clearly named **development-only** Supabase and Cloudflare resources within the budget |
| Live smoke-test authority | MISSING | Approve or deny small OpenAI, Browser Run, STT, and TTS verification calls within the approved cap |
| Development database authority | MISSING | Approve local `supabase db reset` and ordered migrations on a dedicated development project; production databases remain excluded |
| Preview deployment authority | MISSING | Approve or deny an externally reachable non-production `*.workers.dev` preview and LiveKit development deployment. A bare `workers.dev` URL is public unless a separate access control is configured |
| Initial GitHub push | MISSING | Approve pushing the reviewed documentation-only baseline commit to the empty `origin/main`; no force push or history rewrite |
| Supabase project region | MISSING | Approve the closest available North American west region to the Vancouver demo location; the exact provider region is chosen before project creation |
| Generated development secrets | MISSING | Approve or deny Codex generating high-entropy conversation-signing and internal-service tokens and storing them only in ignored/provider secret stores |
| Subscription treatment | MISSING | Confirm whether any approved monthly subscription counts inside the total cap; proposed default is **inside the cap** and still requires separate approval |
| Demo data boundary | READY | Fixed default: fictional NovaFlow data only; no customer, production, regulated, or sensitive personal data |
| Demo branding/default company | READY | Fixed default: SmartService product branding, neutral visual theme, and NovaFlow as the fictional demo tenant unless optional assets are supplied |
| P0 business rules | READY | Defaults in the specification apply: no price, discount, exact delivery, competitor, unsupported certification/claim, secret-disclosure, or unsafe repair commitment |
| Handoff customer-card fields | READY | Name, company, email, phone, preferred language, intent, confirmed facts, channel, summary, risk reason, and next action; unknown values display as not provided |
| Audio recording | READY | Disabled by default; enabling it requires a separate privacy/retention approval |
| Application retention | VERIFY | Approve the specification's 30-day demo record retention; deletion by conversation remains required |

## BLOCKING-P0

Provision these before a live P0 integration can pass G1. If a missing item is explicitly deferred at G0, Codex may build its provider interface and deterministic mock, but G1 remains blocked until the live check succeeds.

| Provider/resource | Status | Required account, plan, permission, or asset | Safe verification |
|---|---:|---|---|
| Supabase development project | MISSING | Dedicated non-production project in the approved region; Free is acceptable for the demo | Confirm project ref and health endpoint; never display keys |
| Supabase browser configuration | MISSING | Project URL and browser publishable/anon key | Initialize the browser client and perform an RLS-constrained anonymous check |
| Supabase server configuration | MISSING | Service-role key and database URL/password | Apply migrations to the dedicated dev project and run a minimal server query |
| Supabase CLI authentication | MISSING | Interactive CLI login or a tooling-only access token stored in native/ignored local storage | Link the project and read migration status without printing credentials |
| Supabase project permissions | MISSING | Permission to manage Auth settings, extensions, migrations, and RLS | Enable/check `vector` and `pg_trgm`; run cross-tenant negative tests |
| Demo identities and tenant-isolation seed | MISSING | Fictional admin and agent in tenant A plus a fictional admin in tenant B; local test passwords only | Login, role, same-tenant positive checks, and cross-tenant denial |
| Cloudflare account | MISSING | Account ID with Workers, Queues, R2, Browser Run, and Turnstile access | `wrangler whoami` and non-destructive resource lists |
| Cloudflare deployment token | MISSING | Least-privilege token for development Worker, Queue, and R2 management | Authenticated dry run/resource listing; do not print token |
| Browser Run token | MISSING | Separate least-privilege token with `Browser Rendering - Edit` | One bounded Markdown crawl against an approved fixture site |
| Worker/static preview | MISSING | Permission to create the single-origin `smartservice-dev` Worker with Static Assets under `workers.dev` | `wrangler deploy --dry-run` first; live preview only after approved deployment authority |
| R2 bucket and upload CORS | MISSING | `smartservice-knowledge-dev` or an approved existing equivalent; exact local/preview origins for short-lived signed PUT uploads | List bucket, verify CORS, then one temporary signed object round trip during P0 |
| R2 signed-URL credentials | MISSING | Bucket-scoped R2 S3 Access Key ID/Secret Access Key for the Worker signer; distinct from the Cloudflare deployment token | Generate a short-expiry single-object PUT URL, upload/HEAD/delete a fictional object, and never print the URL/query or credentials |
| Queues | MISSING | `smartservice-ingest-dev` and `smartservice-finalize-dev` or approved equivalents | List queues; integration test with ID-only payloads |
| Cloudflare Browser Run `/crawl` access | MISSING | Workers Free is sufficient for the bounded demo; verify account entitlement and quotas | One job with same-origin/page/depth bounds and redirect checks |
| OpenAI project/account | MISSING | API project with billing/credit and a project-scoped server key | Minimal authenticated Responses API call |
| `gpt-5-mini` access | MISSING | Configurable alias, no dated snapshot | Tiny Structured Output request validated against schema |
| `gpt-5-nano` access | MISSING | Configurable supervisor alias | Tiny classification request validated against schema |
| `text-embedding-3-large` access | MISSING | 1024-dimension output enabled | One embedding; verify length equals 1024 without logging vector contents |
| Conversation signing secret | MISSING | Locally generated high-entropy value | Sign/verify an expiring test token; never print value |
| Voice-to-API internal token placeholder | MISSING | High-entropy value may be generated now and stored for P1 | Authenticated local service call when the P1 adapter exists |
| G1 preview/runtime location | VERIFY | Default is one Cloudflare Worker with Static Assets plus Hono API to avoid cross-origin drift | HTTPS page load and API health check |
| Public Turnstile keys | CAN-MOCK | Cloudflare test keys locally; real widget keys required only for an externally reachable preview | Test challenge flow, then hostname-bound live challenge before public use |
| Demo ingestion corpus | CAN-MOCK | Generate native-text PDF/DOCX and fixed duplicate, reprocess, scanned/empty, malformed, oversized, and unsupported-file cases from fictional content | Real browser extraction/upload/queue acceptance tests with frozen manifest/hash |
| Bounded demo website | CAN-MOCK | Host a same-origin mini-site with fixed cross-domain/redirect/SSRF cases in an approved non-production preview; optional real company URL later | Bounded live Browser Run crawl with frozen manifest/hash |
| Logo and brand palette | OPTIONAL | Supply assets only if desired | Asset and contrast review |

## BLOCKING-P1

These may be provisioned during P0, but must be ready before Day 6 and live-verified before G2.

| Provider/resource | Status | Required account, plan, permission, or asset | Safe verification |
|---|---:|---|---|
| LiveKit Cloud project | MISSING | Development project with Agent deployment permission; Build plan is acceptable | Project URL reachability and account/project identity |
| LiveKit CLI | MISSING | Install/authenticate `lk` before Agent deployment; not required for P0 | Version/auth status without token output |
| LiveKit API key/secret | MISSING | Server/Agent-only credentials | Generate and validate one short-lived room token |
| LiveKit Agent deployment | MISSING | Permission to deploy `smartservice-voice-agent` | Health check, warming state, Ready event, and room join |
| LiveKit budget/minute boundary | MISSING | Approve maximum development Agent/WebRTC minutes; proposed cap: 300 minutes within the free allowance | Usage dashboard check after smoke tests |
| Deepgram account/API key | MISSING | Nova-3 streaming access; use explicit `zh-CN` or `en` sessions because current `multi` does not include Chinese | Short Chinese and English transcription without logging the key/audio |
| Deepgram budget/minute boundary | MISSING | Approve maximum live STT minutes; proposed cap: 300 minutes within available credit | Provider usage check |
| ElevenLabs account/API key | MISSING | Flash v2.5 streaming access | Generate one short Chinese sentence |
| ElevenLabs voice ID | MISSING | Select a Chinese-capable demo voice; the ID is configuration, not a secret | Short Chinese/English pronunciation test |
| ElevenLabs usage/licence approval | MISSING | Confirm plan permits the intended private sales demo | Account-plan and usage check |
| ElevenLabs budget boundary | MISSING | Approve maximum characters or spend; proposed additional cash cap: USD 15 | Provider usage check |
| Final demo browser/device | MISSING | Identify Chrome or Edge version, macOS device, microphone/headset, and network | Interactive WebRTC/microphone test |
| Audio utility | OPTIONAL | `ffmpeg`/`ffprobe` is useful for bounded prerecorded fixtures and is not required for browser live audio | Version only |
| HTTPS voice URL | MISSING | An approved non-production `workers.dev` URL is acceptable; microphone APIs require HTTPS outside localhost, and access control is separate | Permission prompt, token, room, and audio playback check |
| Final demo region alignment | VERIFY | Browser, Supabase, LiveKit Agent, STT, and TTS should use the closest practical North American regions | Record region and latency-stage evidence |
| Voice privacy notice | READY | Use the specification wording; recording remains off | UI review and network/storage check proving no audio object is retained |

## CAN-MOCK

Mocks are allowed for routine tests, not as substitutes for the live acceptance evidence shown.

| Resource | Mock boundary | Live deadline |
|---|---|---|
| OpenAI Responses and Embeddings | Deterministic schema/citation/guardrail fixtures | Before G1 |
| Cloudflare Browser Run | Provider adapter with bounded fixture responses | K-03/K-04 and before G1 |
| R2 and Queues | In-memory/local adapters for unit tests | Before G1 |
| Turnstile | Official test keys | Before any externally reachable public preview |
| LiveKit room/Agent | Voice UI state-machine mock | Before G2 |
| Deepgram | Prerecorded transcript fixtures | Before G2 |
| ElevenLabs | Silent/test audio adapter | Before G2 |
| Demo PDF/DOCX/site | Generate a versioned ingestion corpus from repository fixtures, including negative/duplicate cases | Valid for G1 if frozen before calibration and exercised through the real ingestion path |
| Extended in-scope evaluation set | Derive and freeze additional questions from the supplied knowledge before any prompt/model calibration | Before G1 |
| Prompt-injection knowledge fixture | Add fixed untrusted-document instructions and prove they cannot override system/tenant controls | Before G1 |
| Advanced SSRF fixture set | Add redirect-to-private, DNS rebinding, alternate IP notation, IPv4-mapped IPv6, userinfo, and scheme cases | Before G1 |
| Tenant-isolation identities | Generate fictional users across two organizations in the dedicated dev environment | Before Day 1 RLS acceptance |
| R11 classification matrix | Derive the missing type/urgency cases only if G3 opens | Before R11 acceptance |
| Email delivery | No-op adapter | No live deadline; full inbound email is out of scope |

## OPTIONAL

| Item | Status | Boundary |
|---|---:|---|
| Custom domain | DEFERRED | `workers.dev` is sufficient; domain/DNS changes need separate approval |
| Supabase Pro | DEFERRED | About USD 25/month; consider only to avoid Free project pausing for a scheduled demo |
| Workers Paid | DEFERRED | Minimum USD 5/month; consider only if Free CPU/Browser Run limits block the demo |
| Firecrawl fallback | DEFERRED | Extra provider, key, and possible cost; use only after a documented Browser Run blocker and explicit approval |
| Resend | NOT-NEEDED | Not on P0/P1 critical path |
| Audio recording | NOT-NEEDED | Off by default; requires explicit consent, retention, deletion, and budget decisions |
| Real company knowledge/website | DEFERRED | Fictional fixtures are sufficient; real data requires a separate data/privacy review |
| Custom logo/colors | DEFERRED | Neutral SmartService branding is sufficient |
| GitHub Actions deployment | DEFERRED | Local validation is sufficient for Gate 0; CI/CD secrets and deploy permissions require separate approval |
| R11 ticket UI | DEFERRED | Entry conditions are enforced after G2 |
| R8/R9/R10, PSTN/SIP, CRM, payment, OCR | NOT-NEEDED | Explicitly out of scope |

## Credential placement and verification matrix

The root `.env.local` is the canonical local source. Day 1 must configure Vite and the voice process to load it explicitly and must keep Wrangler's app-local `.dev.vars` ignored or generated from the canonical source. No tracked file may contain copied values.

| Environment variable | Exposure | Local/deployed storage | Feature | Verification without disclosure |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Browser-safe | `.env.local`; frontend build config | Supabase Auth/Realtime | Load project metadata/client |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe | `.env.local`; frontend build config | RLS-scoped browser client | Anonymous/RLS denial and allowed-login checks |
| `VITE_API_BASE_URL` | Browser-safe | `.env.local`; frontend build config | Hono API routing | `/health` request |
| `VITE_LIVEKIT_URL` | Browser-safe | `.env.local`; frontend build config | WebRTC room | URL/room connection with short-lived token |
| `VITE_TURNSTILE_SITE_KEY` | Browser-safe | `.env.local`; frontend build config | Public abuse control | Widget test challenge |
| `SUPABASE_URL` | Server config, not a secret | `.env.local`; Worker config | Server database client | Project health request |
| `SUPABASE_PROJECT_REF` | Non-secret local config | `.env.local` | CLI project linking | `supabase projects list/link` identity check |
| `SUPABASE_ACCESS_TOKEN` | Tooling-only secret | Native CLI storage or `.env.local`; never app runtime | Non-interactive Supabase CLI | Project identity/list check |
| `SUPABASE_DB_PASSWORD` | Tooling-only secret | `.env.local`; never browser/runtime bundle | CLI migration connection | Migration status/connection check |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only secret | `.env.local`; `wrangler secret put` | Worker/Queue privileged operations | Minimal scoped query |
| `SUPABASE_DATABASE_URL` | Server-only secret | `.env.local`; CI/provider secret store only if later approved | Migrations and integration tests | Connection plus migration status |
| `OPENAI_API_KEY` | Server-only secret | `.env.local`; `wrangler secret put` | RAG, guardrail, summary, embeddings | Tiny model/embedding calls |
| `OPENAI_CHAT_MODEL` | Safe config | `.env.local`/Worker config | Main answer | Report returned model alias |
| `OPENAI_SUPERVISOR_MODEL` | Safe config | `.env.local`/Worker config | Guardrail/summary/R11 | Report returned model alias |
| `OPENAI_EMBEDDING_MODEL` | Safe config | `.env.local`/Worker config | Knowledge retrieval | One embedding |
| `OPENAI_EMBEDDING_DIMENSIONS` | Safe config | `.env.local`/Worker config | pgvector shape | Verify length `1024` |
| `CLOUDFLARE_ACCOUNT_ID` | Non-secret account config | `.env.local`/Wrangler config | Resource targeting | `wrangler whoami` account match |
| `CLOUDFLARE_API_TOKEN` | Local deployment secret | `.env.local` or shell credential store; never deployed to the app | Wrangler resource/deploy operations | Dry run and resource list |
| `CLOUDFLARE_BROWSER_RUN_API_TOKEN` | Server-only secret | `.env.local`; `wrangler secret put` | `/crawl` REST API | Bounded fixture crawl |
| `R2_ACCESS_KEY_ID` | Server-only credential identifier | `.env.local`; `wrangler secret put` | Sign direct browser R2 uploads/downloads | Bounded signed URL test; do not print it |
| `R2_SECRET_ACCESS_KEY` | Server-only secret | `.env.local`; `wrangler secret put` | Sign direct browser R2 uploads/downloads | Bounded signed URL test; never display |
| `R2_S3_ENDPOINT` | Safe server config | `.env.local`/Worker config | R2 S3 signing endpoint | Confirm account endpoint and successful HEAD |
| `TURNSTILE_SECRET_KEY` | Server-only secret | `.env.local`; `wrangler secret put` | Turnstile validation | Test token validation |
| `CONVERSATION_TOKEN_SECRET` | Server-only secret | `.env.local`; `wrangler secret put` | Public conversation JWT/HMAC | Local sign/verify/expiry test |
| `LIVEKIT_URL` | Server config, not a secret | `.env.local`; Worker/Agent config | Room/token/Agent | URL and room reachability |
| `LIVEKIT_API_KEY` | Server-only credential | `.env.local`; Worker and LiveKit secret stores | Token generation and Agent | Short-lived token generation |
| `LIVEKIT_API_SECRET` | Server-only secret | `.env.local`; Worker and LiveKit secret stores | Token generation and Agent | Validate a test token/room join |
| `VOICE_INTERNAL_API_BASE_URL` | Server config | `.env.local`; LiveKit config | Shared RAG/guardrail API | Health/authenticated service request |
| `VOICE_INTERNAL_SERVICE_TOKEN` | Server-only secret | `.env.local`; Worker and LiveKit secret stores | Voice-to-API authentication | Authorized/unauthorized negative tests |
| `DEEPGRAM_API_KEY` | Voice-agent-only secret | `.env.local`; LiveKit secret store | Nova-3 STT | Short Chinese/English transcript |
| `DEEPGRAM_STT_MODEL` | Safe config | `.env.local`/Agent config | STT model | Session metadata |
| `DEEPGRAM_STT_LANGUAGE` | Safe config | `.env.local`/Agent config | Chinese STT | Transcript language check |
| `ELEVENLABS_API_KEY` | Voice-agent-only secret | `.env.local`; LiveKit secret store | TTS | Short synthesis |
| `ELEVENLABS_VOICE_ID` | Non-secret provider config | `.env.local`/Agent config | Demo voice | Pronunciation smoke test |
| `ELEVENLABS_MODEL_ID` | Safe config | `.env.local`/Agent config | Flash v2.5 | Session/request metadata |
| `DEMO_ADMIN_EMAIL` / `DEMO_AGENT_EMAIL` / `DEMO_OTHER_ADMIN_EMAIL` | Non-secret fictional identity | `.env.local`; never production | Demo login/two-tenant seed | Login, role, and tenant-boundary checks |
| `DEMO_ADMIN_PASSWORD` / `DEMO_AGENT_PASSWORD` / `DEMO_OTHER_ADMIN_PASSWORD` | Server-side test secrets | `.env.local` only | Demo login/two-tenant seed | Login without displaying password |
| `FIRECRAWL_API_KEY` | Optional server-only secret | Only after explicit approval | Crawl fallback | One bounded crawl |
| `RESEND_API_KEY` | Optional server-only secret | Only after explicit approval | Optional follow-up email | Sandbox send only |

## Proposed cost boundary

Current official free tiers are sufficient for most infrastructure, but only the user can approve spend:

- Supabase Free: USD 0; project pausing after inactivity is a demo reliability risk.
- Cloudflare Workers/Queues/R2/Browser Run Free: USD 0 at this scale; Browser Run Free allows only a small daily crawl quota.
- OpenAI: approve up to USD 20 inside the proposed total cap for calibration, evaluations, and smoke tests.
- LiveKit Build: target USD 0 within free hard caps; proposed development cap 300 Agent minutes.
- Deepgram: target USD 0 within available credit; proposed cap 300 STT minutes.
- ElevenLabs: confirm commercial demo rights first; use an eligible plan and approve at most USD 15 additional spend if the included character allowance blocks P1 testing.
- Contingency: USD 15, unused unless separately explained.
- **Proposed aggregate cap: USD 50. No subscription upgrade or billable resource creation is implicit in this proposal.**

## Exact user actions

1. Create the ignored local file:

   ```bash
   cp .env.example .env.local
   ```

2. Provision or select the P0 Supabase, Cloudflare, and OpenAI development resources above. Put values only in `.env.local` and provider secret stores; do not send them in chat.
3. Confirm the `BLOCKING-NOW` approvals: total USD cap and subscription treatment, dev resource creation, small live smoke tests, dev database reset/migrations, externally reachable preview deployment, generated development secrets, initial GitHub push, 30-day retention, and the Supabase region.
4. Confirm that the fictional NovaFlow fixture data and neutral SmartService branding are acceptable, or place optional logo assets in a local path and provide only the path.
5. Before Day 6, provision LiveKit, Deepgram, and ElevenLabs; select a Chinese-capable voice; identify the final Chrome/Edge demo device and microphone/headset; approve voice-minute/character caps.
6. After storing credentials, report only which variable groups are present, for example: `Supabase P0 ready; Cloudflare P0 ready; OpenAI P0 ready; P1 deferred.` Do not report values.
7. Reply with explicit Gate 0 approval only after the approvals and resource state are accurate.

## Gate 0 approval record

- Approved by:
- Approval date:
- Approved total live-provider budget:
- Approved development resource creation:
- Approved live smoke tests:
- Approved local/dev database reset and migrations:
- Approved externally reachable preview deployment:
- Approved generated development secrets:
- Approved initial GitHub push:
- Approved Supabase region:
- Approved 30-day retention:
- Monthly subscriptions inside/outside cap:
- P0 credential groups present:
- P1 credential groups present or deferred:
- Remaining exceptions:
