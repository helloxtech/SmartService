# SmartService Autonomous Delivery Progress

original_goal:
Repair hosted SmartService knowledge ingestion and retrieval so uploaded websites, documents, approved manual answers, and contextual follow-up questions work end to end.

scope_boundary:
Keep the locked Cloudflare/Supabase/OpenAI architecture, tenant isolation, citation validation, guardrails, and hosted-development boundary. Do not start R11, weaken refusal behavior, expose secrets, or disturb unrelated work.

human_gates:
On August 2, 2026, Forrest Zhang explicitly authorized the Project Lead to make all necessary product and technical decisions and complete the work. This authorizes one least-privilege Cloudflare Browser Run token, its Worker-secret storage, hosted-development deployment, source reprocessing, bounded provider calls, and live verification. Paid upgrades, production/customer data, destructive actions, and R11 remain outside this authorization.

current_phase:
Hosted knowledge retrieval repair and live acceptance.

active_step:
Publish the deterministic approved-manual path and complete the live confirmation and unsupported-question acceptance cases.

completed_steps:
Reproduced both hosted failures; implemented and deployed split live providers, calibrated retrieval, contextual follow-ups, the current Browser Run contract, and bounded GPT-5 reasoning; completed website v3 with 10 real documents and 65 OpenAI-embedded chunks; live customer acceptance now answers the school name and course question with citations; the exact manual question retrieved its approved chunk at `0.881005` but GPT-5 returned a citation-format validation failure, so exact approved answers and their immediately following confirmations now use a deterministic cited path before the unchanged output guardrails, with assistant-core and API suites green.

next_step:
Deploy the approved-manual path, verify the exact answer and `are you sure?` in one fresh conversation, then verify one unsupported-question handoff and finalize status/resource evidence.

verification_evidence:
The live conversation and knowledge pages reproduced the exact user report. `smartservice.ca/health` returned the hosted development Worker. The actual music-school corpus produced semantic similarity requiring the new calibrated threshold. The final `pnpm check` passed after the credential/configuration change: formatting, lint, every workspace typecheck, all 133 tests, the production web builds, and the Cloudflare Worker dry run.

blockers:
None currently. The required OpenAI and least-privilege Browser Run secrets are installed on the existing hosted-development Worker, and the user approved the remaining deploy, source-reprocessing, and live-verification mutations.

decisions:
Decouple upload, crawl, and embeddings so one missing provider credential cannot silently force unrelated features into mock behavior. Use real OpenAI embeddings/chat for hosted retrieval, keep the current signed same-origin development upload adapter, use the specified Cloudflare `/crawl` REST provider with a least-privilege token, and contextualize only clearly dependent follow-ups.

files_changed:
Assistant-core retrieval logic/tests, API provider selection/retrieval/tests/generated bindings, Worker configuration, environment/deployment documentation, this progress ledger, and pending status/decision evidence.

resume_instruction:
Read this ledger and current `git status`; reuse the existing signed-in Cloudflare and SmartService browser tabs when available. Resume `active_step`, never print secrets, and distinguish local, deployed, reprocessed, and live-answer evidence.

last_updated:
August 2, 2026
