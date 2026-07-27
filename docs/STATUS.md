# SmartService Project Status

**Last updated:** July 26, 2026
**Current gate:** G0 — Resource and readiness audit
**Current phase:** Gate 0 documentation and repository baseline
**Active step:** Await resource provisioning, approval boundaries, and explicit Gate 0 approval
**Overall state:** Blocked at the required human approval gate; no product code started

## Original goal

Lead and deliver SmartService as a two-week reusable demo: P0 text customer-service closed loop, P1 browser voice, and optional R11 only after P0/P1 acceptance and remaining-time checks.

## Scope boundary

- In scope now: repository/specification audit, SmartService identity migration, resource and budget audit, secret-safety preparation, architecture validation, Git baseline, and Gate 0 reporting.
- Not authorized now: P0/P1 feature code, live resource creation, remote database mutation/reset, externally reachable deployment, billable provider use, or GitHub push.
- Later gates: stop for G1 after P0, G2 after P1, and G3 before optional R11.

## Delivery summary

| Scope | State | Acceptance |
|---|---|---|
| Gate 0 | Audit complete; approval pending | Waiting for Forrest Zhang |
| P0 | Not started by design | Not run |
| P1 | Not started by design | Not run |
| R11 | Deferred | Entry conditions not met |

## Completed steps

- Inventoried and read all 29 relevant project files: 26 text/config/spec/fixture files and 3 PDFs.
- Read the root lead instructions, operator guide, project prompt, all specifications, all blueprints, all fixtures, and both source-document sets.
- Extracted and visually reviewed all 4 pages of the original requirement PDF and all 6 pages of the broader Full AI source document.
- Confirmed the source PDF under `docs/spec/source/` is byte-identical to its duplicate under `需求/`.
- Completed independent read-only resource, architecture, and acceptance reviews and reconciled their high-impact findings into the controlling documents.
- Validated the locked stack against current official documentation for OpenAI models, Supabase pgvector/RLS, Cloudflare Browser Run/Queues/R2, LiveKit Agents, Deepgram Nova-3 Chinese, and ElevenLabs Flash v2.5.
- Initialized Git on `main`, configured the requested GitHub remote, and set the repository-local author identity to the existing `helloxtech` convention.
- Verified the remote is reachable and currently has no `main`/`HEAD` ref; no push was attempted.
- Verified Node.js, pnpm, Git, Supabase CLI, Docker, Wrangler through the package runner, Chrome, Edge, and Safari.
- Confirmed `.env.local` is absent and audited provider environment-variable names are unset without printing values.
- Migrated repository-owned product identity to SmartService and standardized the environment-variable contract.
- Hardened ignore rules for environment files, Wrangler variables, credentials, certificates, generated artifacts, and audio recordings.
- Completed the consolidated classified resource, credential-placement, permission, budget, asset, browser, and deployment request.

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
| SQL blueprint execution | Deferred until approved Day 1 migrations; no database mutation authorized at G0 |
| Product tests/build/evals | Not run; no product code exists and Gate 0 forbids implementation |
| Live provider smoke tests | Not run; credentials/budget/approval absent |
| Cost-bearing provider calls | None |

## Current blockers

- Explicit Gate 0 approval.
- `.env.local` creation and P0 credential groups.
- Approved total USD cap and provider-specific voice limits.
- Authority boundaries for dev resource creation, live smoke calls, development migrations/reset, an externally reachable preview, generated service secrets, and initial GitHub push.
- Supabase project region selection.
- P1 provider credentials, commercial-use confirmation, voice ID, and final microphone/device/network may be deferred until before Day 6.

See `docs/RESOURCE_REQUEST.md` for the complete one-message request and exact non-secret actions.

## Decisions

- Durable decisions are in `docs/DECISIONS.md`.
- Gate 0 proposals marked `pending G0 confirmation` become approved only when Forrest Zhang explicitly accepts Gate 0 or replaces them.

## Files changed in Gate 0

- `.env.example`
- `.gitignore`
- `AGENTS.md`
- `CODEX_PROJECT_LEAD_PROMPT.md`
- `MANIFEST.md`
- `README.md`
- `README_OPERATOR_CN.md`
- `docs/RESOURCE_REQUEST.md`
- `docs/STATUS.md`
- `docs/DECISIONS.md`
- Repository-owned identity/configuration sections under `docs/spec/`

## Cost to date

- Project provider cost recorded: **USD 0**.
- No live project provider calls or paid resource actions were made.

## Next step

Forrest Zhang reviews `docs/RESOURCE_REQUEST.md`, stores secrets only in ignored/provider stores, answers all `BLOCKING-NOW` boundaries in one message, and explicitly approves Gate 0. Codex then verifies resources without displaying values and starts Day 1 only if the approval/resource state allows it.

## Resume instruction

Read this file, `docs/RESOURCE_REQUEST.md`, `docs/DECISIONS.md`, and current `git status` first. If Gate 0 is not explicitly approved, do not implement product code. If it is approved, verify the documented resource groups non-destructively, record the G0 approval, and begin the Day 1 foundation slice.
