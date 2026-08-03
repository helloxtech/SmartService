# Smart Service Project Status

**Last updated:** August 3, 2026 PDT
**Current gate:** Local P0/P1 UAT evidence complete; hosted DEV live knowledge ingestion and grounded text acceptance complete; full G1 remains pending
**Current phase:** The reported hosted knowledge failures are repaired and live-accepted; the remaining P0 work is the production-grade signed upload and Turnstile boundary
**Active step:** Hold at the remaining G1 resource boundary while keeping the accepted hosted DEV knowledge path available for UAT
**Overall state:** Days 1–10 remain green locally. Hosted DEV now uses live OpenAI chat, evidence-aware auxiliary review, and embeddings plus live Cloudflare Browser Run crawling; the supplied music website is Ready with 10 documents and 65 chunks, the supplied DOCX is Ready with 13 chunks, and the approved manual answer is Ready with one chunk. Live browser acceptance proved both reported website questions with citations, reliable English and Chinese course answers, the exact approved answer and `are you sure?` follow-up with the same citation, and safe handoff for an unsupported inventory question. Public chat merges polling and send completion by authoritative message ID, preventing duplicate answers. Three obsolete seeded demo sources are disabled and no longer retrievable. Full P0 G1 is not claimed because the current development upload adapter still needs bucket-scoped R2 signer credentials and the public endpoint still needs hostname-bound Turnstile keys. P1 Agent deployment, final device evidence, and ElevenLabs commercial-use confirmation also remain pending.

## Recent hosted UAT fixes

- August 3, 2026 PDT: Reproduced the English course false handoff in the live Agent audit: retrieval/generation produced a course candidate, but `NO_UNSUPPORTED_CLAIM` supervision blocked it because the auxiliary model could not see its approved evidence. Released evidence-aware `guardrail-supervisor-v2` in `d69ae21`, sending only the candidate's one-to-five validated cited chunks, bounded to 4,000 characters each; evidence cannot override price, delivery, competitor, security, safety, or other rules. Product QA then exposed and fixed a polling/send race that duplicated one slow answer; `3862e48` now merges messages by authoritative ID. Worker version `84425727-19ac-4020-a01c-867de5d2c24e` passed 3/3 fresh English course answers with five citations and one rendered answer each, one Chinese cited course answer, and one unsupported inventory handoff without citations. The final `pnpm check` passed formatting, zero-warning lint, strict typechecks, 137 tests, production builds, and the Worker dry run.
- August 2, 2026 PDT: Repaired and released hosted knowledge ingestion/retrieval through production `main` commit `e9bd023f5b8314c2d22a2261930422be6d2946dc`, accepted on Worker version `a78953d6-899e-4a81-add5-646c9051c280`. Split provider modes removed the silent mock-crawl fallback; Browser Run v3 produced 10 real music-school documents and 65 live embedded chunks; the supplied DOCX and manual answer reprocessed to 13 and 1 chunks. Live browser acceptance answered the school-name and course questions with source citations, preserved the approved manual answer through `are you sure?` with its citation, and handed an unsupported inventory question to a human without citations. The complete `pnpm check` passed formatting, lint, strict typechecks, 135 tests, production builds, and the Worker dry run. Three obsolete seeded demo sources were disabled, not deleted.
- August 1, 2026 PDT: Released HelloX Feedback `0.2.3` from production `main` commit `3053246118680b9e348c6428674847d0f9d6e1e2`. Functional acceptance used Cloudflare deployment `caa3892e-d402-482b-ae9a-c5e9c76fe35f` and Worker version `0ae977a5-e808-4a29-9948-15d9c066abc4`; later documentation-only deployments preserve that runtime behavior. The live vendored bundle SHA-256 is `d836a797d9064f6f7e9060a0ec1b4738b109a0730f227ceb8b7297805b24ef89`. `/health`, `/chat`, and `/api/public-config` returned `200`; a real browser proved the full-label, five-second icon-only, immediate-hover expansion, and two-second pointer-leave collapse states with zero console warnings/errors and without opening or submitting feedback.
- August 1, 2026 PDT: Prepared HelloX Feedback `0.2.2` locally, then released its contact-handling correction as part of 0.2.3. The browser no longer renders or submits `Email for updates`; authenticated member email is required by SmartService Auth and sent only through the server-to-server identity exchange, while anonymous intake remains contact-free. The exact 0.2.2 candidate bundle was SHA-256 `68c11d1d4b9f026c0d3d4b518f003260c4c8e7af8e55075a8d6643bbceb10404`. `pnpm check` passed formatting, lint, all workspace typechecks, 130 tests, production web builds, and the Worker dry run; all 5 Playwright flows and all 8 Feedback installer checks passed.
- August 1, 2026 PDT: Released HelloX Feedback `0.2.1` from production `main` commit `0fd6e59d4d60344ef4f107035f10b89b044e2d3c`. Functional acceptance used Cloudflare deployment `e58dbb97-3e0c-4317-a548-b1e597d1030e` and Worker version `75dd5111-b4f2-4bd0-bedd-2c8f998958ce`; later documentation-only deployments preserve that runtime behavior. `https://smartservice.ca` serves bundle SHA-256 `ac06387840c33d8c4b9b5d76ea3cedb9f137278d8de7bcc3f41aa8cad91a0edb`. Live browser acceptance produced an automatic Tailwind 4 screenshot and retained two distinct marker comments; the draft was cleared without creating a test ticket.
- July 31, 2026 PDT: Applied Forrest's free-plan/placeholder instruction. Current official provider checks show Cloudflare Browser Run is available on Free/Paid plans, LiveKit Build has a free tier but Cloud Agent deployment is early-access gated on this project, Deepgram can remain in free-credit/test mode, and ElevenLabs Free still cannot support commercial/sales-facing generated speech. Missing paid/permission items remain placeholders rather than being bypassed with broad credentials.
- July 31, 2026 PDT: Installed `lk` 2.18.2 into Forrest's local user bin path, added non-secret LiveKit Agent deployment packaging (`Dockerfile`, `.dockerignore`, `livekit.toml`), built the `smartservice-voice-agent:local` container, and verified the container Agent configuration schema with existing local secrets without printing values.
- July 31, 2026 PDT: LiveKit Cloud created Agent `CA_bifEfej5s7Di`, but deployment did not complete. The BYOC image path returned an Enterprise-only error, and the free Build-service source path returned `Agent deployments are in early access and not yet enabled for this project`. No live G2 claim is made.
- July 31, 2026 PDT: Updated hosted seed/verification tooling to support explicit hosted Supabase URL overrides. `https://smartservice.ca` hosted smoke passed routes, health, runtime Supabase sign-in, two cited answer cases, and one safe handoff through the public API. Direct hosted service-role seed/count remains blocked until the online `SUPABASE_SERVICE_ROLE_KEY` is stored locally or connector SQL works for the visible project.
- July 30, 2026 PDT: Reworked the team workspace after hosted UAT feedback. Authenticated pages now use a wider workspace container; Dashboard, Inbox, Knowledge, Knowledge gaps, and Guardrails receive the selected UI language; the language switch uses fixed `English` / `中文` labels; the Agent handoff panel now separates customer card, summary, suggested reply, deterministic suggested actions, useful citations, and source links without making additional AI/provider calls.
- July 30, 2026 PDT: Removed Flow-style browser-visible branding. Public chat now shows Smart Service Support, the first AI greeting is `Hello, I'm the Smart Service Assistant. How can I help?`, the workspace subtitle is `AI Assistant Workspace` / `AI 助手工作台`, stale hosted answer/citation text is normalized to Smart Service, and the Chat/Portal shell received an Apple-inspired translucent layout pass.
- July 30, 2026 PDT: Replaced simultaneous bilingual demo labels with a visible UI language switch. English and Chinese modes now render separate copy on the sign-in shell, public chat, voice page, and team navigation; a follow-up UAT patch extends this into the deeper admin workspaces.
- July 30, 2026 PDT: Added a temporary hosted deployment bridge so public text and voice try the current demo public key first, then retry the legacy demo key only on `WIDGET_NOT_FOUND`; stale hosted welcome, answer, and citation display text is normalized in the browser so Git/Cloudflare deployment can proceed before hosted Supabase data is refreshed.
- July 30, 2026 PDT: Added visible language-switchable UI copy to the main login, public chat, team navigation, and browser voice surfaces.
- July 30, 2026 PDT: Updated the hosted and local Smart Service Admin login email to `info@smartservice.ca`; the password was reset in Supabase Auth and ignored `.env.local` only. No password value was committed.
- July 29, 2026 PDT: Fixed pending human handoff UX so opening a conversation in the Agent portal does not imply a claim. Customers can add details while waiting for human support or after a human connects; these messages persist for the Agent and do not trigger AI/provider calls. Agent replies remain disabled until the conversation is claimed. Hosted Supabase migration and Cloudflare Worker version `bee3c1c4-4813-455c-ad2d-0f14230b8ca2` were verified with temporary smoke data that was deleted after validation.

## Original goal

Lead and deliver SmartService as a two-week reusable demo: P0 text customer-service closed loop, P1 browser voice, and optional R11 only after P0/P1 acceptance and remaining-time checks.

## Scope boundary

- In scope now: Day 1 through Day 10 P0/P1 implementation, local tests, deterministic provider mocks, approved development resources, and bounded smoke tests within the USD 50 cap.
- Not authorized now: production deployment, production data, destructive production actions, paid upgrades without separate approval, or R11 before G3.
- Review gates: automatic continuation through G1/G2 implementation is authorized by `DEC-053`; hosted acceptance claims remain evidence-gated, and G3 still gates optional R11.

## Delivery summary

| Scope | State | Acceptance |
|---|---|---|
| Gate 0 | Approved July 26, 2026 | Baseline `b965aabd027c7c5b1d063f3ee0e5daaf711f0b45` published to `origin/main` |
| P0 | Days 1–5 complete locally | Full composite checkpoint and three independent clean-reset demos passed; hosted deployment/provider evidence remains |
| P1 | Days 6–10 complete locally | Voice session, grounded/TTS, semantic turn, interruption, local latency, handoff, reconnect, failure, and integrated demos are green; live provider/device evidence remains |
| R11 | Deferred | Entry conditions not met |

## Completed steps

- Inventoried and read all 29 relevant project files: 26 text/config/spec/fixture files and 3 PDFs.
- Read the root lead instructions, operator guide, project prompt, all specifications, all blueprints, all fixtures, and both source-document sets.
- Extracted and visually reviewed all 4 pages of the original requirement PDF and all 6 pages of the broader Full AI source document.
- Confirmed the source PDF under `docs/spec/source/` is byte-identical to its duplicate under `需求/`.
- Completed independent read-only resource, architecture, and acceptance reviews and reconciled their high-impact findings into the controlling documents.
- Validated the locked stack against current official documentation for OpenAI models, Supabase pgvector/RLS, Cloudflare Browser Run/Queues/R2, LiveKit Agents, Deepgram Nova-3 Chinese, and ElevenLabs Flash v2.5.
- Initialized Git on `main`, configured the requested GitHub remote, and set the repository-local author identity to the existing `helloxtech` convention.
- Published the reviewed Gate 0 baseline to `origin/main` and verified local/remote commit equality.
- Verified Node.js, pnpm, Git, Supabase CLI, Docker, Wrangler through the package runner, Chrome, Edge, and Safari.
- Created the ignored `.env.local` container from `.env.example`; generated local Supabase/demo values are present, external provider values remain unset, and no values were displayed.
- Migrated repository-owned product identity to SmartService and standardized the environment-variable contract.
- Hardened ignore rules for environment files, Wrangler variables, credentials, certificates, generated artifacts, and audio recordings.
- Completed the consolidated classified resource, credential-placement, permission, budget, asset, browser, and deployment request.
- Created an eight-project pnpm workspace with strict TypeScript, ESLint Allman-brace enforcement, formatting, Vitest, Playwright, and fixed-fixture evaluation commands.
- Added the React/Vite/Tailwind/shadcn-style authentication shell, responsive desktop/mobile layout, shared UI package, browser-safe configuration validation, and role-aware membership display.
- Added the Hono Cloudflare Worker health contract, generated Wrangler bindings, structured request logs, safe JSON errors, Static Assets configuration, Worker-runtime tests, and a successful deployment dry run.
- Split the P0 data blueprint into four ordered Supabase migrations with `vector(1024)`, HNSW/trigram indexes, composite tenant foreign keys, explicit privileges, forced RLS, immutable audit links, and no P1/R11 tables.
- Created fictional Smart Service Admin and Agent identities plus an isolation-tenant Admin in ignored local storage; verified all three real Auth login paths without displaying credentials.
- Proved tenant and role isolation with 16 pgTAP assertions, including cross-tenant denial, Agent/Admin boundaries, blocked-candidate privacy, human-sender enforcement, and anonymous permission denial.
- Added deterministic fixture-integrity checks for the fixed P0 and guardrail sets without making provider calls.
- Visually inspected the built shell at 2560×1440 and 390-pixel mobile width and corrected shared Tailwind source discovery before acceptance.
- Added tenant-authenticated Admin intake and source-management APIs plus Agent read-only source visibility.
- Added five-minute single-object R2 PUT authorizations, a signed local R2 adapter, server-side tenant prefix/size/MIME/metadata/SHA-256/file-signature verification, and production fail-closed mock protection.
- Added real browser PDF.js extraction with page locators and scanned/encrypted rejection, Mammoth DOCX extraction with headings/tables, mixed Chinese/English standard-page calculation, and on-demand parser bundles.
- Added bounded same-origin URL intake, public-address and DNS-rebinding checks, the Cloudflare Browser Run `/crawl` adapter, an explicitly inactive Firecrawl stub, and a deterministic local crawler.
- Added the Cloudflare Queue ingestion consumer, deterministic source-aware chunking, stable versioned document/chunk IDs, 1024-dimension OpenAI embedding adapter with bounded retry, deterministic mock embeddings, and atomic database promotion.
- Added retry, disable, enable, soft-delete, object cleanup, progress, and bounded error UX. Reprocessing keeps the prior active version retrievable until the replacement version commits.
- Generated and froze a deterministic real eight-page PDF, heading-aware DOCX, three-page same-origin mini-site, and SHA-256 manifest. Repeated fixture generation now produces byte-identical outputs.
- Ran the full local browser path through Auth, signed upload, local R2, Queue, Supabase, and deterministic embeddings: PDF, DOCX, and URL all reached Ready with 3 sources and 20 enabled embedded chunks.
- Expanded database security and lifecycle coverage from 16 to 30 pgTAP assertions and added API/browser/package tests for role denial, upload integrity, SSRF, idempotency, version activation, and production provider boundaries.
- Split the authenticated knowledge workspace, React, Supabase, PDF.js, and DOCX parser into bounded production chunks and visually reviewed the completed desktop and mobile layouts.
- Added scoped public conversation tokens with organization, subject, nonce, expiry, and explicit message/read/handoff scopes; invalid signatures, expiry, wrong organizations, and URL-subject mismatches fail closed.
- Added server-side Turnstile verification with expected action, optional hostname, timeout, bounded retry, and an explicit non-production deterministic adapter.
- Added the OpenAI Responses API adapter with strict Structured Outputs, configurable undated model aliases, request timeout/retry, `store: false`, typed usage capture, and a zero-cost deterministic fixture provider.
- Added shared Chinese/English RAG prompt/schema logic, localized safe handoff responses, exact retrieval-set citation validation, and deterministic semantic feature hashing for the fixed local corpus.
- Added atomic public-conversation database functions for rate limiting, idempotent creation/messages, AI turn completion, citations, handoff packages, merged knowledge gaps, and complete `ai_runs`/audit links.
- Added the responsive public `/chat` page with bilingual copy, citation chips/excerpts, explicit human handoff, session-only scoped-token storage, and one-second cursor/ETag polling.
- Exercised the fixed Day 3 set through the real local Worker and Supabase: 12/12 in-scope questions returned persisted citations and 8/8 unsupported questions produced safe handoff plus open knowledge gaps.
- Visually reviewed the public chat at desktop and 390-pixel mobile widths and confirmed no horizontal overflow.
- Added deterministic input and candidate-output guardrails for all six fixed business rules, plus a strict auxiliary-model supervisor adapter and redacted Agent-facing event DTOs.
- Made the Worker the only state-transition boundary for guardrail completion, handoff claiming, human replies, conversation closure, and finalization; direct authenticated table mutation and guardrail-event reads are revoked.
- Added atomic guardrail persistence that withholds blocked candidate text, writes the safe response, event, AI run, audit evidence, handoff package, and incremental summary together.
- Added authenticated Agent/Admin inbox, detail, takeover, human-message, close, guardrail-rule, and Admin-only candidate/event APIs with organization and role enforcement.
- Added the responsive team workspace with one-second inbox/detail polling, required customer-card fields, citations, handoff context, assignment, human messaging, closure, and Admin guardrail configuration.
- Added ID-only finalization Queue processing with duplicate-before-model protection, strict Structured Output validation, complete audit persistence, and `ticket: null` while R11 remains gated.
- Added the ordered Day 4 migration, a 29-assertion pgTAP suite, six-case deterministic guardrail evaluation, API/core tests, and a zero-cost local Day 4 end-to-end verifier.
- Added exact date-filtered total, containment, handoff, and unresolved-gap aggregation with closed-conversation denominators and explicit inclusive/exclusive date semantics.
- Added Admin-only grouped knowledge-gap list/detail, strict ignore/reopen actions, one-click manual knowledge, shared Queue/R2 ingestion progress, and automatic resolution only after the linked source becomes Ready.
- Added source-scoped original-question re-test with exact retrieved-set citation enforcement, zero-cost deterministic exact manual Question/Answer support, AI-run audit, and no internal evidence IDs in browser DTOs.
- Added responsive Dashboard and Knowledge gaps workspaces with date filters, compact rate charts, status grouping, example-conversation links, loading/empty/error states, one-click resolution, progress polling, and cited re-test results.
- Added the eighth ordered P0 migration, a 31-assertion Day 5 pgTAP suite, API/web/core coverage, complete OpenAPI contracts, P0 demo/evaluation documents, and a zero-cost Day 5 end-to-end verifier.
- Corrected the Day 2 ingestion verifier to navigate explicitly to Knowledge after the Day 5 default-route change, then passed the complete Day 5 checkpoint from a fresh database.
- Ran three consecutive clean-reset P0 demos with distinct diagnostic, calibration, and replacement questions; every full local chain passed with no Blocker/Critical defect and no provider cost.
- Added tenant-owned forced-RLS voice sessions, voice-enabled organization configuration, service-only lifecycle functions, short-lived LiveKit token issuance, explicit Agent dispatch, and production mock-provider denial.
- Added service-token-authenticated Agent configuration/status/transcript endpoints that accept only opaque session IDs and persist final STT text idempotently through the existing conversation boundary.
- Replaced the disabled P1 scaffold with a named LiveKit Agents Node worker using explicit Deepgram Nova-3 Chinese/English STT, ID-only dispatch metadata, transcript persistence, Ready/failed lifecycle reporting, and audio recording disabled.
- Added `/voice` with explicit-click creation, muted warming, documented Agent-state detection, Ready-gated microphone activation, bilingual selection, live transcript display, teardown, and friendly text fallback.
- Added the two ordered Day 6 migrations, 12 voice pgTAP assertions, API/Agent/web coverage, expanded OpenAPI contract, and a zero-cost local end-to-end verifier.
- Refactored text orchestration behind one caller-authorized shared turn method so Agent-authenticated voice uses the exact same retrieval, model alias, citation validation, deterministic and auxiliary guardrails, handoff, persistence, and audit path.
- Added the internal final voice-turn contract, idempotent Agent retries, lifecycle transition to Active/Handoff, and a bounded spoken-answer projection that excludes URLs, UUIDs, JSON delimiters, and citation metadata.
- Configured the LiveKit Agent with ElevenLabs `eleven_flash_v2_5`, explicit voice/language settings, streaming-aligned TTS, common product/unit speech normalization, and manual shared-pipeline reply control.
- Added screen polling for the approved voice answer and public citations while keeping URLs, citation IDs, and internal JSON out of TTS.
- Frozen five Chinese and five English voice RAG parity cases and passed all ten through both text and voice with exact answer/citation parity; missing knowledge safely handed off with no citations.
- Replaced manual final-transcript reply control with LiveKit's bundled multilingual turn detector and native Agent LLM hook while retaining the shared server-authoritative RAG/guardrail boundary.
- Locked adaptive interruption at 500 milliseconds, 2-second false-interruption recovery with resume, dynamic endpointing, preemptive generation, and preemptive TTS disabled.
- Attached the remote Agent audio track in the browser and added a Web Audio energy probe so production playback timestamps originate from browser-received audible samples rather than TTS first-byte events.
- Added a fixed 40-turn local voice runner with 20 Chinese and 20 English turns, exact 28/8/4 simple/follow-up/missing-or-guardrail distribution, nearest-rank percentiles, full raw timestamps, and separate empty failure/warming/cold-start groups.
- Recorded clean-checkpoint local/mock P50 `24.643 ms`, P95 `31.913 ms`, maximum `37.296 ms`, 40/40 successful submitted turns, and zero provider cost. This report is explicitly ineligible for G2 because it lacks real browser/provider/device/network clocks.
- Added active-turn cancellation to the Agent's internal Worker call, a fixed bilingual safe provider-failure phrase, bounded service timeout, failed-session reporting, and post-playout shutdown for handoff or terminal provider failure.
- Added LiveKit native reconnect visibility plus at most two application-level token-refresh reconnects after terminal disconnect; intentional shutdown, permission denial, and handoff never start a retry loop.
- Made voice handoff terminal in the customer UI, denied token refresh once the conversation leaves AI control, and preserved the text fallback.
- Corrected the human inbox contract from text-only to text-or-voice, then added voice provider/status/warmup/failure and nearest-rank server-assistant timing detail with an explicit warning that it is not browser turn-to-audio timing.
- Passed a focused Day 9 smoke for delivery-commitment guardrail, missing knowledge, persisted handoff/session state, stopped AI, Agent-visible voice detail, denied post-handoff token refresh, redacted internal failure, reconnect coverage, and zero provider cost.
- Normalized every workspace and Worker health version to `0.10.0` and added one destructive-local-only Day 10 composite checkpoint.
- Added deployment, UAT execution, and UAT-readiness guides with exact local commands, hosted-provider gates, rollback boundaries, severity rules, and the local/mock versus live evidence distinction.
- Ran three consecutive full P0/P1 local demos—diagnostic, calibration, and replacement—from independent fresh resets; every ingestion, text, guardrail, handoff, dashboard/gap, voice parity, 40-turn, and failure/recovery chain passed.
- Archived the three-run timestamps/durations and zero-cost result in `docs/evidence/day10-local-demo-runs.json`; the stable 40-turn voice snapshot remains in `docs/evidence/day8-local-voice-report.json`.
- Audited tracked implementation/operator files for unresolved work markers and executable debugger statements.
- Declined R11 entry because live G2 acceptance is absent. R11 remains disabled and no ticket migration or UI exists.
- Replaced the previously exposed LiveKit development key, verified the exposed key row was removed in LiveKit Cloud, and stored the replacement only in ignored mode-`0600` `.env.local`.
- Ran bounded live smokes without printing credentials: OpenAI Responses chat, OpenAI auxiliary/supervisor Responses, OpenAI 1024-dimension embeddings, LiveKit authenticated room listing plus short-lived token generation, and Deepgram Nova-3 English and Chinese transcription.
- Re-ran `pnpm verify:day10` and `pnpm demo:full:three`; all three fresh local demo chains passed again and regenerated `docs/evidence/day10-local-demo-runs.json`.
- Created a least-privilege ElevenLabs development API key with Text to Speech, Voices Read, and Models access; stored it only in ignored mode-`0600` `.env.local`.
- Selected and stored an ElevenLabs voice ID, then passed one bounded Chinese MP3 synthesis smoke with `eleven_flash_v2_5`.
- Fixed the local LiveKit Agent worker entrypoint so the Cloud worker loader imports a pure Agent definition instead of the CLI launcher.
- Passed a live local `/voice` browser join smoke: public voice conversation and room token returned `provider=live`, LiveKit Cloud dispatched `smartservice-voice-agent`, the Agent fetched server configuration, and the Worker recorded Ready before microphone publication.
- Confirmed automated browser microphone access was denied in Playwright, leaving real microphone/STT/TTS/audio-playback UAT for the final demo device.
- Disabled LiveKit session log/trace recording export in the Agent because project data recording is disabled; app-owned bounded console metrics remain available and audio recording stays off.
- Confirmed from official ElevenLabs commercial-use guidance and the account UI that the current Free plan is not sufficient for a commercial/private sales demo; paid-plan approval remains required before final G2/commercial demo claims.
- Paused the wrongly created connector-owned Supabase `SmartService` project `wfkheempcfislbaonkiz`; CLI deletion remains blocked because no access token is available for that hidden connector account.
- Created the correct browser-owned Supabase `SmartService` organization and project `ibuvpregltbvxsxhivrg` in `us-west-2`; stored project URL, publishable key, secret server key, database URL, and database password only in ignored `.env.local`.
- Applied all 10 ordered migrations to the correct hosted Supabase project, applied `supabase/seed.sql`, created/refreshed the three fictional hosted Auth users, and verified demo access plus cross-tenant organization isolation.
- Created the Cloudflare DEV storage and queue resources required by `apps/api/wrangler.jsonc`: `smartservice-knowledge-dev`, `smartservice-knowledge-preview`, `smartservice-ingest-dev`, `smartservice-finalize-dev`, `smartservice-ingest-dlq-dev`, and `smartservice-finalize-dlq-dev`.
- Deployed the `smartservice-dev` Cloudflare Worker/Static Assets preview at `https://smartservice-dev.hurryupgo-b2d.workers.dev`, set the currently available Worker secrets without printing values, and verified `/health`, hosted Admin login, public conversation creation, and one public message smoke in DEV/mock-provider mode.
- Connected Cloudflare native Workers Builds for `smartservice-dev` to `helloxtech/SmartService` on production branch `main`; commit `d5f9d1c` triggered the first Git-based Cloudflare build/deploy and activated version `d90cf5c8`.
- Added repeatable hosted DEV tooling: `pnpm hosted:seed-demo-knowledge` seeds the fictional Smart Service PDF/DOCX/URL fixtures through the shared deterministic ingestion pipeline, and `pnpm verify:hosted-dev` checks routes, health, ready knowledge, cited answers, and missing-knowledge handoff.
- Seeded hosted DEV with 3 Ready fictional sources and 23 embedded chunks; hosted public text smoke now returns cited answers for the UAT guide's sample in-scope questions and safe handoff for missing warehouse-stock knowledge.
- Narrowed public human support UX so the customer does not see a standing transfer button on first load; the UI offers human help only after customer frustration, repeated clarification, or request failure, while explicit handoff requests remain server-owned.
- Verified the user-signed browser can access the correct Supabase project `SmartService` / `ibuvpregltbvxsxhivrg`; the Supabase connector remains attached to the wrong hidden organization and must not be used for this hosted DEV project.
- Pushed the hosted handoff updates to `helloxtech/SmartService` `main`; Git is clean and aligned with `origin/main`, and the Cloudflare dashboard/CLI showed a new post-push Worker deployment. Because documentation commits also trigger Worker builds, verify the current version ID with `wrangler deployments list` instead of treating any recorded version ID as durable.
- Diagnosed the hosted sign-in warning on `smartservice.ca` as a Cloudflare Git Build environment issue: the static asset was compiled without local `VITE_SUPABASE_*` values. Added `/api/public-config`, runtime Supabase browser-client initialization, a Cloudflare `SUPABASE_ANON_KEY` secret, and hosted verification coverage for runtime Supabase Admin sign-in.

## Architecture findings

1. The modular-monolith design is feasible for the two-week demo if the team holds the P0-before-P1 gates and uses mocks only for routine development.
2. Cloudflare Browser Run `/crawl` is a current REST API requiring `Browser Rendering - Edit`; the Free plan's daily crawl/browser quota is sufficient for controlled tests but needs caching and a prepared fallback fixture. The Workers Free 10 ms CPU ceiling may still force an approved USD 5 Paid plan for chunking/queue work if benchmarks fail.
3. `vector(1024)` plus HNSW is compatible with current pgvector limits; complete per-table RLS policies and negative tenant tests must be produced in Day 1 because the SQL file is explicitly only a blueprint.
4. Client-side PDF/DOCX extraction is feasible for the controlled admin-only demo, but it is not a production integrity boundary. The server must still validate MIME, size, page/standard-page counts, object ownership, content hash, and tenant association.
5. A bare `workers.dev` preview is publicly reachable. G1 defaults to a local run unless an external preview and its access/abuse controls are approved.
6. LiveKit Cloud supports the required Node.js turn/interruption features, but the free Build plan can cold-start. The Ready/warming UX is mandatory, and P95 measurement begins only after the documented user-initiated prewarm.
7. Deepgram Nova-3 currently supports simplified Mandarin through explicit `zh-CN`, but its documented `multi` set does not include Chinese. P1 uses explicit Chinese or English sessions. ElevenLabs Flash v2.5 supports low-latency multilingual TTS, but model numbers, dates, currencies, and units require explicit text normalization and pronunciation tests.
8. The original source expresses `<1.5s` like a hard per-turn requirement; the controlling prompt and acceptance spec define an honest warm-turn P95 target. This resolution is recorded in `DEC-009`.
9. The supplied fixture set is incomplete for the acceptance document's extended in-scope accuracy, prompt-injection, advanced SSRF, two-tenant identity, and full optional R11 matrices. Those derived fixtures must be frozen before calibration so expected results are not changed to hide failures.
10. The SQL blueprint's immediate knowledge-source cascade conflicts with citation retention through `ON DELETE RESTRICT`. The implementation uses soft-disable/tombstone and object lifecycle cleanup, with physical deletion only when retained citations can be deleted safely.
11. Fixed case `OUT-08` contradicted the product manual; it now tests unsupported high-altitude derating while preserving the 12/8 acceptance counts.
12. The missing browser contracts are now explicit: short-lived signed PUT URLs generated with a bucket-scoped R2 S3 signer credential kept in Worker secrets, plus conversation-token Worker polling for public human messages. Public clients receive neither storage credentials nor direct Supabase access.
13. The retrieval blueprint now filters enabled current documents, gives exact model/number and trigram evidence a lexical path, and thresholds the combined score rather than semantic similarity alone.
14. AI artifacts link to `ai_runs`; Agent guardrail results are redacted and blocked candidate text is Admin-only.
15. Candidate supervision cannot be fully parallel with answer generation. Only prechecks/retrieval preparation run in parallel; guardrail and citation validation complete before text delivery or audible TTS.
16. The G2 latency protocol now fixes language split, sample count, percentile method, browser playback clock, failure handling, and raw-trace retention. R11's ambiguous time threshold is resolved to four uninterrupted hours after G2 acceptance.
17. The largest schedule risks are account access, fixed-set RAG/guardrail calibration, URL crawl quota/SSRF behavior, Chinese voice quality, and the guarded P95 voice path—not repository scaffolding.
18. Day 2 keeps routine development at zero provider cost through explicit deterministic adapters, but any production runtime configured for mock ingestion fails closed.
19. Knowledge reprocessing uses a new target version while the prior active version remains retrievable; only atomic completion switches active documents/chunks. Duplicate intake, retry, and Queue delivery paths are idempotent.
20. Browser extraction is convenience, not trust: the Worker rechecks object ownership, declared and actual size, MIME metadata, signed integrity metadata, SHA-256, PDF/DOCX magic bytes, extracted-schema consistency, and locked page limits.
21. Public conversation authorization is independent of Supabase browser sessions: a short-lived scoped token binds every operation to one organization and one conversation while all database access stays behind the Worker.
22. A factual answer is not committed unless every returned citation belongs to the exact retrieved set and still resolves through the enabled active source version. Answer, citations, AI run, handoff/gap, and audit records commit atomically.
23. The live combined-score retrieval threshold remains `0.72`. Local deterministic chat uses a zero threshold only to validate orchestration against feature-hashed fixtures; it is not live embedding calibration or hosted-model evidence.
24. Production fails closed unless ingestion, chat, and Turnstile are all configured for live providers. Turnstile bypass exists only in explicit non-production mode.
25. Public response DTOs expose purpose-built citation IDs, labels, excerpts, and optional source URLs; internal chunk/database evidence IDs remain server-side.
26. Guardrail and handoff transitions are Worker-owned service operations. Authenticated browser clients cannot mutate conversation/message/rule state or directly read guardrail events.
27. Every customer input is checked deterministically before retrieval; every candidate answer is checked deterministically and by the auxiliary supervisor before it may be delivered. A blocked candidate is retained only in Admin-authorized evidence.
28. The public conversation token becomes read-only after handoff or closure so customers may poll human/final messages while AI writes remain disabled.
29. Finalization is an ID-only, single-concurrency Queue path that reconciles authoritative conversation state and checks for an existing final record before any model call.
30. Public voice startup remains conversation-token bound: the browser supplies no organization ID, room credential lifetime is ten minutes, Agent dispatch metadata contains only `voiceSessionId`, and the Agent retrieves configuration through a distinct server-only bearer boundary.
31. Microphone publication occurs only after the LiveKit Agent state leaves initialization; mock mode reproduces the lifecycle for zero-cost tests but is forbidden in production and cannot count as live WebRTC/STT evidence.
32. Voice does not create a second RAG implementation: the internal Agent endpoint performs service-token authentication, resolves the session's authoritative organization/conversation, and calls the same turn processor used after public text authorization.
33. Only the server-approved public answer is eligible for TTS. A separate bounded `spokenText` removes non-speech artifacts and citations remain a screen-only payload; the Agent performs final product/unit pronunciation normalization before ElevenLabs streaming synthesis.

## Validation evidence

| Check | Result |
|---|---|
| Complete repository file inventory | Passed; 29 relevant files |
| Text/config/spec/fixture review | Passed; 26/26 files |
| Original PDF text extraction | Passed |
| Original PDF visual page review | Passed, 10/10 pages legible |
| Duplicate requirement PDF SHA-256 comparison | Passed; hashes match |
| JSON parsing and fixed acceptance counts | Passed; 12 in-scope, 8 out-of-scope, 6 guardrail, 5 optional ticket cases |
| OpenAPI YAML/local reference validation | Passed; 14 paths, 15 operations, 19 local refs |
| Markdown code-fence validation | Passed; 19 files |
| Staged Git whitespace/error check | Passed; 29-file documentation baseline |
| Ignore-rule verification | Passed for 10 representative secret/generated paths |
| Secret-pattern scan | Passed; no key/JWT/private-key pattern found |
| Identity/obsolete environment-alias scan | Passed |
| Git repository initialization | Passed; `main` |
| Remote configuration | Passed; requested URL |
| Read-only remote check | Passed; empty remote refs |
| Secret filename/environment presence audit | Passed; no local secret file/values found |
| Node.js | `v24.16.0` |
| pnpm | `11.9.0` |
| Git | `2.50.1` |
| Supabase CLI | `2.109.1` |
| Docker daemon | `29.5.2` |
| Wrangler | `4.114.0` via package runner |
| `pnpm check` | Passed in the Day 4 checkpoint: format, lint, strict typecheck, package/API/real-browser tests, code-split web build, and Worker Queue/R2/Static Assets dry run |
| `pnpm test:e2e` | Passed: 2 Chromium tests covering the foundation shell and responsive public chat/evidence panel |
| `pnpm eval:p0` | Passed: 4 tests, including deterministic 12/12 cited in-scope and 8/8 missing-knowledge handoff behavior; live model quality remains unclaimed |
| `pnpm eval:guardrails` | Passed: all six fixed cases were blocked by their expected enabled rule with safe handoff |
| `supabase db reset` | Passed from all eight ordered P0 migrations and deterministic seed |
| `supabase test db` | Passed: 121/121 tenant, role, privacy, ingestion, conversation, citation, rate-limit, idempotency, guardrail, handoff, finalization, dashboard, knowledge-gap, voice-session, audit, and anonymous-denial assertions |
| `supabase db lint --schema public` | Passed; no schema errors |
| RLS posture query | Passed: 18/18 public tables have RLS enabled and forced; `anon` has 0 table privileges |
| Foreign-key index audit | Passed: every public foreign key has an exact leading-column index, including tenant-qualified composite keys |
| Local Auth verification | Passed: Smart Service Admin, Smart Service Agent, and isolation-tenant Admin; each sees exactly one tenant |
| Worker Static Assets dry run | Passed with Static Assets, Queue, and R2 bindings; no deployment performed |
| Cloudflare hosted resource creation | Passed: two SmartService R2 buckets and four SmartService Queues created and listed |
| SmartService Worker packaging dry run | Passed: `wrangler deploy --dry-run` read 16 Static Assets files and resolved Queue/R2/Assets bindings |
| Wrong Supabase project deactivation | Passed: connector-created `wfkheempcfislbaonkiz` is inactive; true deletion remains blocked without that account's CLI/API token |
| Correct hosted Supabase project creation | Passed: browser-created `SmartService` project `ibuvpregltbvxsxhivrg` is healthy in `us-west-2` |
| Correct hosted Supabase migration/seed | Passed: remote dry run is up to date; verification found 10 migrations, 19 public tables, and 19 forced-RLS tables; hosted seed and three fictional Auth identities are ready |
| Targeted public-chat tests after conditional human-support UX change | Passed: 11 DOM tests plus 5 browser tests |
| Targeted API conversation-service tests after handoff detector change | Passed: 8/8 tests |
| Targeted API health test after broad-suite timeout | Passed: 2/2 tests; the earlier broad wrapper timeout did not reproduce in the focused run |
| Dependency audit | Passed: no known production vulnerability at `high` or above |
| Day 1 secret-pattern scan | Passed; no key/JWT/private-key pattern in candidate commit files |
| Local secret handling | Passed; `.env.local` is ignored with mode `0600` and no values were printed |
| Deterministic Day 2 fixture regeneration | Passed; two consecutive PDF/DOCX/site generations produced identical manifest hashes |
| Real-browser PDF/DOCX extraction | Passed: 5/5 Chromium extraction/hash and negative-boundary tests against committed binary fixtures |
| API knowledge tests | Passed: auth/role, upload authorization and metadata, file signatures, URL rejection, source list, intake, and live-adapter retry boundaries |
| Local Day 2 ingestion smoke | Passed: real browser plus local Auth/Worker/R2/Queue/Supabase; 3 Ready sources and 20 enabled embedded chunks |
| Day 3 conversation-token tests | Passed: signature, expiry, scope, organization, URL subject, and safe rejection boundaries |
| Day 3 Responses/Turnstile adapter tests | Passed: strict Structured Output request, validated response/usage, timeout/retry, action, hostname, and production mock denial |
| Local Day 3 conversation smoke | Passed: 12/12 cited answers, 8/8 missing-knowledge handoffs, 12 persisted citations, 8 open gaps, polling/304, idempotency, manual handoff, and AI-run links |
| OpenAPI contract validation | Passed: 26 paths, 29 operations, 42 unique local references, no missing local reference |
| Desktop/mobile visual inspection | Passed; Knowledge and public chat layouts have no horizontal overflow at 390 pixels |
| Day 4 strict TypeScript check | Passed for all eight workspace projects |
| Day 4 ESLint check | Passed for all workspace packages |
| Day 4 verifier JavaScript syntax | Passed with `node --check tooling/local/verify-day4.mjs` |
| Full Day 4 composite checkpoint | Passed: user-run checkpoint passed through database lint; the evaluation import defect was corrected and re-run green; final smoke passed 6/6 guardrails, handoff under 3 seconds, AI stopped, human polling under 3 seconds, closure/finalization, and zero provider cost |
| Day 5 focused static checks | Passed: contracts/API/web strict TypeScript, repository ESLint, Prettier, OpenAPI YAML parse, and verifier `node --check` |
| Day 5 API tests | Passed within the 12-file API suite: 36/36 tests |
| Day 5 web workspace tests | Passed: 3/3 dashboard, manual-resolution, and cited re-test tests |
| Day 5 focused Playwright flow | Passed in Chromium: real local Auth plus dashboard, gap detail, one-click resolution, and displayed citation |
| Local Day 5 smoke | Passed: exact dashboard `+2` closed-handoff deltas, one 2-occurrence grouped gap, Agent/Admin and two-tenant isolation, manual source Ready, cited source-scoped re-test, and zero provider cost |
| Full Day 5 composite checkpoint | Passed in one uninterrupted Codex run after fixing the explicit Knowledge-navigation regression: reset/bootstrap, check, Chromium, 109/109 database assertions, lint, evaluations, and Days 2–5 smokes |
| Three consecutive P0 demo runs | Passed from clean resets: diagnostic 00:23:12–00:24:27 PDT, calibration 00:24:27–00:25:41 PDT, replacement 00:25:41–00:26:55 PDT |
| Day 6 focused static checks | Passed: contracts/API/Agent/web strict TypeScript and repository Prettier |
| Day 6 API and Agent tests | Passed: 38/38 API tests across 13 files and 3/3 Agent foundation tests |
| Day 6 web tests | Passed: 7/7 unit tests plus 5/5 real-browser extraction tests, including no-pre-click creation, Ready-gated microphone, transcript display, and denial fallback |
| Local Day 6 smoke | Passed: zero pre-click sessions, tenant-bound mock token, internal Agent authentication denial/allow, Ready timestamp, exact Chinese transcript persistence, replay idempotency, and zero provider cost |
| Full Day 6 composite checkpoint | Passed from a clean reset: format, lint, all strict workspace typechecks/tests/builds, 4/4 Playwright flows, 121/121 database assertions, database lint, and the Day 6 Worker/Supabase smoke |
| Day 7 API and Agent tests | Passed: 39/39 API tests and 4/4 Agent tests, including speech projection and product/unit normalization |
| Day 7 web tests | Passed: 8/8 unit tests plus 5/5 real-browser extraction tests; the voice UI displays approved answer citations without adding them to transcript/audio |
| Local Day 7 smoke | Passed: 5/5 Chinese and 5/5 English grounded answers, exact text/voice answer and public-citation parity, public screen payloads, safe missing-knowledge handoff, bounded speech text, and zero provider cost |
| Full Day 7 composite checkpoint | Passed from a clean reset: format, lint, all workspace typechecks/tests/builds, 4/4 Playwright flows, 121/121 pre-smoke database assertions, database lint, fresh 3-source/20-chunk ingestion, and the Day 7 smoke |
| Day 8 focused Agent/web tests | Passed: semantic turn/interruption settings, preemptive TTS safety, remote audio attachment path, and browser playback-clock callback |
| Local Day 8 40-turn evaluation | Passed: 20 Chinese + 20 English; 28 simple, 8 follow-up, 4 missing/guardrail; 40/40 successful submitted turns; nearest-rank P50 `24.643 ms`, P95 `31.913 ms`, max `37.296 ms`; local/mock only |
| Full Day 8 composite checkpoint | Passed from a clean reset: format, lint, all workspace typechecks/tests/builds, 4/4 Playwright flows, 121/121 database assertions, database lint, fresh 3-source/20-chunk ingestion, Day 7 parity smoke, and the fixed Day 8 40-turn evaluation |
| Day 9 focused tests | Passed: 7/7 Agent tests including obsolete-turn cancellation and fixed failure speech; 10/10 web unit tests including bounded token-refresh reconnect and terminal handoff; 39/39 API tests |
| Local Day 9 smoke | Passed: delivery guardrail, missing knowledge, persisted voice handoff, AI stopped, Agent voice detail, post-handoff token refresh denied, redacted service failure, and zero provider cost |
| Full Day 9 composite checkpoint | Passed from a clean reset: format, lint, all workspace typechecks/tests/builds, 4/4 Playwright flows, 121/121 database assertions, database lint, fresh ingestion, Day 7 parity, Day 8 40-turn evaluation, and Day 9 safety/recovery smoke |
| Three consecutive Day 10 full demos | Passed again on July 28, 2026 UTC: diagnostic `97.037 s`, calibration `86.807 s`, replacement `102.738 s`; fresh reset each; complete P0/P1 local chain; zero provider cost |
| Full Day 10 composite checkpoint | Passed from a clean reset after adding a bounded local Auth-readiness wait: format, lint, all workspace typechecks/tests/builds, 4/4 Playwright flows, 121/121 database assertions, database lint with no errors, P0/guardrail evaluations, local access, Days 2–10 smokes, and release audit |
| `pnpm verify:day10` | Passed on July 27, 2026 PDT: release audit confirmed version `0.10.0`, three clean full demos, 40 retained voice traces, UAT/deployment bundle, no unresolved debug debt, R11 closed, and no provider cost |
| Live provider smoke tests | Passed locally for OpenAI chat/supervisor/embeddings, LiveKit authenticated API/token generation, Deepgram English/Chinese STT, and ElevenLabs Chinese TTS. Hosted DEV additionally passed live OpenAI chat/auxiliary/embedding and Browser Run crawling; signed R2 upload, live Turnstile, and live G2 evidence remain pending |
| Hosted DEV Worker smoke | Passed after Git deploy: `smartservice-dev` `/health` returned `200`, hosted Admin login passed, public conversation creation returned `201`, and public message send returned `200` |
| Hosted DEV text UAT smoke | Passed again on August 2 against `https://smartservice.ca` with real tenant knowledge: 2/2 website questions cited live-crawled pages, the exact approved manual answer and immediate confirmation both cited the approved manual source, and 1/1 unsupported question handed off without citations. The three supplied sources show Ready with 79 total chunks. |
| HelloX Feedback integration | Passed for deployed `0.2.3` with exact bundle SHA-256 verification, verified-host-email handling, contact-free anonymous intake, adaptive-launcher timing, and upstream Tailwind 4 screenshot regression coverage. The one global widget supports anonymous and authenticated intake, anonymous attachments remain disabled, and the same-origin identity-session adapter requires a valid SmartService Supabase bearer session. |
| HelloX Feedback 0.2.2 candidate | Passed: exact bundle/manifest hash, 8/8 installer controls, server-only verified account-email exchange, legacy browser-email removal, 130 workspace tests/builds, Worker dry run, and 5/5 Chromium flows. Its contact-handling correction was subsequently released in 0.2.3. |
| HelloX Feedback 0.2.3 release | Passed: exact bundle/manifest hash, 8/8 installer controls, explicit 5-second/2-second host configuration, reusable timer/accessibility coverage, 130 workspace tests/builds, Worker dry run, 6/6 Chromium flows, desktop/mobile visual inspection, Git-triggered Worker version 56, and live custom-domain verification. |
| Live HelloX Feedback smoke | Passed on August 1 against `https://smartservice.ca`: exact-origin CORS preflight returned `204`; `/health`, `/chat`, and `/api/public-config` returned `200`; the live widget matched SHA-256 `d836a797d9064f6f7e9060a0ec1b4738b109a0730f227ceb8b7297805b24ef89`; the adaptive launcher passed live timing and console checks; the earlier screenshot/marker and authenticated-session checks remain valid; and no feedback ticket was created during 0.2.3 verification. |
| HelloX Feedback security checks | Passed: exact CSP origins are deployed, Turnstile is configured for `smartservice.ca`, the server key is held only as a Cloudflare Worker secret, no server/Supabase secret appears in tracked source, and the plugin verifier reports all eight controls green. |
| Local Smart Service and Chinese UI update checkpoint | Passed: format, lint, typecheck, unit tests, build, 4/4 Playwright tests, P0 evaluation, guardrail evaluation, 121/121 database assertions, ingestion/conversation/Days 4–10 smokes, local same-origin Supabase browser configuration, and targeted web type/unit/browser tests for the hosted public-key fallback |
| July 31 Cloudflare P0 live-secret audit | Blocked: `.env.local` does not contain `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_BROWSER_RUN_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `TURNSTILE_SECRET_KEY`, or `VITE_TURNSTILE_SITE_KEY`; Wrangler OAuth works locally but is not deployed as an app secret |
| LiveKit CLI install | Passed: `lk` 2.18.2 installed to `/Volumes/Forrest/Users/Forrest/.local/bin/lk`; `lk agent list` authenticated with existing LiveKit URL/API credentials and found Agent `CA_bifEfej5s7Di` |
| LiveKit Agent container packaging | Passed: root Agent `Dockerfile` and `.dockerignore` built `smartservice-voice-agent:local`; non-network container config validation returned `voice agent config ok`; `pnpm format:check` and `pnpm --filter @smartservice/voice-agent typecheck` passed |
| LiveKit Cloud Agent deployment | Blocked: local-image deployment returned Enterprise-only BYOC error; source/Dockerfile deployment returned `Agent deployments are in early access and not yet enabled for this project`; no deployed Agent or G2 evidence is claimed |
| Cost-bearing provider calls | Bounded live smokes only: three OpenAI Responses/Embeddings calls, two Deepgram STT calls, one ElevenLabs TTS call, and a LiveKit authentication/token check |

## Current blockers

- Hosted Supabase uses current Smart Service display values where local hosted credentials allow updates. A narrow legacy public-key fallback remains temporarily because existing deployed widgets may still reference the older non-secret key.
- Hosted P0 no longer blocks on basic Supabase schema, demo identities, Cloudflare Worker deployment, core Worker secrets, Queues/R2 buckets, Browser Run, live OpenAI chat/auxiliary/embeddings, or grounded DEV text acceptance. Full G1 still blocks on bucket-scoped R2 signer credentials for the production-grade direct upload path and hostname-bound Turnstile site/secret keys; upload and Turnstile therefore remain explicit development mocks.
- P1 live acceptance remains blocked on LiveKit Cloud Agent deployment enablement, ElevenLabs commercial-use confirmation, and final microphone/device/network verification. Provider credentials, local smokes, local Agent packaging, and a pending LiveKit Agent record are verified, but they do not by themselves satisfy live G2.

See `docs/RESOURCE_REQUEST.md` for the complete one-message request and exact non-secret actions.

## Decisions

- Durable decisions are in `docs/DECISIONS.md`.
- Gate 0 defaults were approved by Forrest Zhang on July 26, 2026 and are recorded in `DEC-031`.
- Automatic testing ownership and continuation through Day 10 were approved by Forrest Zhang on July 27, 2026 and are recorded in `DEC-053`.

## Day 10 checkpoint scope

- Complete P0/P1 static, package, browser, database, evaluation, ingestion, text, guardrail, dashboard/gap, voice parity, 40-turn, and failure/recovery regression.
- Three retained full demo chains from fresh databases.
- Version `0.10.0`, release audit, UAT/deployment documents, immutable evidence, debug-debt scan, and R11 closed-gate check.
- Checkpoint command: `pnpm checkpoint:day10`.

## Cost to date

- Project provider cost recorded before live smoke: **USD 0**.
- Bounded live smoke calls have now been made under the approved USD 50 cap; no paid upgrade or subscription change was performed, and exact provider-side dollar cost has not been computed.
- HelloX Feedback provisioning used the existing Cloudflare, Supabase, and Delivery Hub resources; verification created no feedback ticket and incurred no separately identified paid resource.

## Next step

Provision the remaining R2 signer and live Turnstile credentials before running full hosted G1. For G2, enable LiveKit Cloud Agent deployments on the current project or provide another LiveKit project with Agent deployments enabled, then confirm an ElevenLabs commercial-use eligible plan before final sales-facing voice UAT. R11 remains gated.

## Resume instruction

Read this file, `docs/RESOURCE_REQUEST.md`, `docs/DECISIONS.md`, and current `git status` first. Gate 0 is approved. Resume the active numbered slice, preserve its validation checkpoint, and stop only at a documented human gate or genuine blocker.
