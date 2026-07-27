# SmartService Project Status

**Last updated:** July 27, 2026
**Current gate:** Local P0 evidence complete; automatic P1 continuation authorized
**Current phase:** Day 8 turn, interruption, and local latency evidence complete; full checkpoint and publication next
**Active step:** Run and publish the separate Day 8 checkpoint, then implement Day 9 voice guardrail, handoff, and failure recovery
**Overall state:** Days 1–7 are published and green locally; the fixed 40-turn Day 8 local/mock evaluation is green; hosted P0 and live voice-provider/device evidence remain unavailable without external credentials

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
| P1 | Days 6–8 complete locally | Voice session, grounded/TTS, semantic turn, adaptive interruption configuration, browser audio, and fixed local latency evidence are green; Days 9–10 and live provider/device evidence remain |
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
- Created fictional NovaFlow Admin and Agent identities plus an isolation-tenant Admin in ignored local storage; verified all three real Auth login paths without displaying credentials.
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
| Local Auth verification | Passed: NovaFlow Admin, NovaFlow Agent, and isolation-tenant Admin; each sees exactly one tenant |
| Worker Static Assets dry run | Passed with Static Assets, Queue, and R2 bindings; no deployment performed |
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
| Live provider smoke tests | Not run; external P0 provider credentials remain absent |
| Cost-bearing provider calls | None |

## Current blockers

- P0 provider credentials and a dedicated development project remain unset; hosted P0 integration and a live G1 claim remain blocked until those groups are provisioned.
- P1 provider credentials, commercial-use confirmation, voice ID, and final microphone/device/network verification remain absent. Local/mock Day 6–10 work proceeds under `DEC-053`, but live voice quality/latency cannot be claimed without them.

See `docs/RESOURCE_REQUEST.md` for the complete one-message request and exact non-secret actions.

## Decisions

- Durable decisions are in `docs/DECISIONS.md`.
- Gate 0 defaults were approved by Forrest Zhang on July 26, 2026 and are recorded in `DEC-031`.
- Automatic testing ownership and continuation through Day 10 were approved by Forrest Zhang on July 27, 2026 and are recorded in `DEC-053`.

## Day 8 checkpoint scope

- LiveKit multilingual semantic turn detection with adaptive interruption, 500-millisecond minimum duration, false-interruption resume, and dynamic endpointing.
- Native preemptive generation with preemptive TTS disabled, preserving the no-audio-before-guardrail boundary.
- Browser remote-audio attachment and audible-sample playback-start detection; audio recording remains disabled.
- Forty retained local/mock traces with the locked bilingual/scenario distribution and nearest-rank P50/P95/max/all-submitted reporting.
- Checkpoint command: `pnpm checkpoint:day8`.

## Cost to date

- Project provider cost recorded: **USD 0**.
- No live project provider calls or paid resource actions were made.

## Next step

Run and publish the separate Day 8 slice, then implement and validate Day 9 voice guardrail, handoff, provider timeout/cancel/reconnect, token refresh, and failure UX. Preserve the local/mock versus hosted evidence boundary and keep R11 gated.

## Resume instruction

Read this file, `docs/RESOURCE_REQUEST.md`, `docs/DECISIONS.md`, and current `git status` first. Gate 0 is approved. Resume the active numbered slice, preserve its validation checkpoint, and stop only at a documented human gate or genuine blocker.
