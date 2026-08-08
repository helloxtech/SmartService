# SmartService Autonomous Delivery Progress

original_goal:
Complete every material text-customer-service gap identified in the August 7 requirements audit before the August 9 full-system demonstration. Add tenant-generic live human-agent reply assistance, improve handoff and final records, repair knowledge-gap lifecycle quality, validate the full customer-to-human workflow, and release the exact verified revision to smartservice.ca.

scope_boundary:
Keep the existing Cloudflare Workers, Supabase, OpenAI/Workers AI, React, and shared assistant-core architecture. The new R10 slice assists a human only after handoff: it may prepare grounded drafts and sources, but it never sends a customer message, bypasses tenant isolation, weakens citations or guardrails, or embeds school-specific language. Do not add R8, R9, R11, PSTN, CRM, billing, multi-region HA, or a paid provider plan.

human_gates:
Forrest Zhang explicitly requested completion and production deployment for the August 9 demonstration and confirmed READY on August 7, 2026. This authorizes reversible source changes, ordered migrations against the existing SmartService hosted database, one cost-conscious Git push, the connected Cloudflare production deployment, bounded existing-provider calls, and hosted verification. Paid upgrades, new subscriptions, destructive deletion, external customer data, and architecture changes remain separate gates.

qa_target_flow:
Customer sends a text message -> the online service answers with approved citations or enters handoff -> a human claims the conversation -> each new customer message produces one current grounded draft with sources -> the human inserts, edits, and sends it -> closure produces and displays the complete follow-up record -> analytics and knowledge gaps reflect authoritative outcomes.

acceptance_criteria:
1. Public text input clears and locks immediately after send, and supported answers remain company-voiced and cited.
2. Handoff immediately shows a context-specific summary, intent, next step, and safe draft instead of a fixed generic template.
3. In handoff or active-human state, the newest customer message asynchronously creates one tenant-grounded suggestion; older suggestions become stale and cannot be marked used.
4. Suggestions expose safe source cards, never auto-send, and can only be inserted/sent by the owning human operator.
5. Closed conversations display summary, intent, outcome, customer facts, follow-up actions, and personalized suggested wording.
6. Low-information/customer-service meta turns do not create knowledge gaps, and later grounded answers reconcile matching historical open gaps.
7. Tenant-negative database/API tests, formatting, lint, strict typecheck, unit/integration/evaluation tests, production builds, and rendered browser QA pass.
8. The deployed canonical site and API identify the exact intended commit and pass the complete hosted text/handoff/assist/close smoke flow.

current_phase:
Local release candidate complete; hosted database and deployment gate pending.

active_step:
Obtain access to canonical Supabase project ibuvpregltbvxsxhivrg, apply and verify the two ordered migrations, then push once and run the exact hosted customer-to-human acceptance flow.

completed_steps:
Confirmed the clean conversation-owned worktree contains the exact hosted lineage and preserved the stale/diverged primary checkout. Implemented the shared contracts, ID-only Queue command, tenant-scoped suggestion persistence/RPCs, stale and source invalidation, shared grounded/guardrailed generation, human-only usage audit, low-latency team polling, contextual handoff snapshots, operator draft/source UI, complete final-record rendering, generic knowledge-gap eligibility, and evidence-backed gap reconciliation. Added API, assistant-core, web, and 26-assertion database regressions plus the controlling specification, API blueprint, resource, status, and decision updates.

next_step:
After the user signs the in-app Supabase session into the account that owns SmartService project ibuvpregltbvxsxhivrg, apply migrations 20260807000300 and 20260807000400 transactionally, execute the database assertions, then create the final documentation checkpoint, push main once, wait for Cloudflare, and verify the complete production flow.

verification_evidence:
Prettier, zero-warning ESLint, all strict workspace typechecks, all production builds, and the Worker dry run passed. The complete package suite passed 232 tests: config 2, contracts 7, assistant-core 60, ingestion 30, voice Agent 13, web unit 24, web browser 5, and API 91. P0 evaluation passed 4/4 and guardrail evaluation passed 1/1. Both new migrations installed together on a clean PostgreSQL 17 validation database. Playwright passed 5/6 credential-free flows; the authenticated flow stopped before login because the ignored demo-admin values are empty, not because of a product assertion. The exact Supabase project URL was checked in the signed-in in-app browser and redirected to an account containing only Apple Seeds Holding.

blockers:
Release blocker: the current Supabase browser session has no access to canonical SmartService project ibuvpregltbvxsxhivrg, and local ignored configuration contains variable names but no database URL, service-role key, or demo credentials. The only visible Supabase project belongs to Apple Seeds and was intentionally left untouched. Database assertions, migration application, Git push, Cloudflare deployment, and hosted smoke remain gated to prevent deploying Worker code before its required database contract. Full public-production claims also still depend on the live Turnstile and R2 signer credentials documented in RESOURCE_REQUEST.md; no paid plan or fallback is enabled.

decisions:
Reuse the existing finalization Queue for a new ID-only agent.reply_suggest command. Persist one suggestion per customer trigger message, supersede older pending/ready suggestions, validate all cited chunks against the tenant and active source version, update the handoff snapshot with an immediate contextual fallback and later grounded draft, and record suggestion use only when a human message explicitly references it. Reconcile knowledge gaps from authoritative answer events rather than tenant-specific cleanup rules.

files_changed:
Shared contracts; API types, services, Queue, conversation/team repositories and routes; assistant-core retrieval eligibility; Agent workspace, API client, preview, and tests; two ordered migrations and database assertions; OpenAPI and architecture/acceptance/resource/status/decision/progress documentation.

resume_instruction:
Read this ledger and current git status. Continue from active_step in the existing clean worktree. Do not print secrets, create paid resources, or deploy an untested revision.

last_updated:
August 7, 2026
