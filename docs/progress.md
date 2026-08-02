# SmartService Autonomous Delivery Progress

original_goal:
Repair hosted SmartService knowledge ingestion and retrieval so uploaded websites, documents, approved manual answers, and contextual follow-up questions work end to end.

scope_boundary:
Keep the locked Cloudflare/Supabase/OpenAI architecture, tenant isolation, citation validation, guardrails, and hosted-development boundary. Do not start R11, weaken refusal behavior, expose secrets, or disturb unrelated work.

human_gates:
On August 2, 2026, Forrest Zhang explicitly authorized the Project Lead to make all necessary product and technical decisions and complete the work. This authorizes one least-privilege Cloudflare Browser Run token, its Worker-secret storage, hosted-development deployment, source reprocessing, bounded provider calls, and live verification. Paid upgrades, production/customer data, destructive actions, and R11 remain outside this authorization.

current_phase:
Hosted knowledge retrieval repair completed and accepted live.

active_step:
None for this repair. Hold at the separate full-G1 R2 signer and Turnstile resource boundary.

completed_steps:
Reproduced both hosted failures; implemented and deployed split live providers, calibrated retrieval, contextual follow-ups, the current Browser Run contract, bounded GPT-5 reasoning, and a deterministic cited path for exact approved manual answers and their immediate confirmations. Website v3 is Ready with 10 real documents and 65 OpenAI-embedded chunks; the supplied DOCX and manual answer are Ready with 13 and 1 chunks. Live customer acceptance answered the school name and course questions with citations, returned the approved answer and cited `are you sure?` confirmation in one conversation, and safely handed off an unsupported inventory question without citations. Three obsolete seeded demo sources were disabled, not deleted.

next_step:
When full G1 is resumed, provision bucket-scoped R2 signing credentials and hostname-bound Turnstile keys, replace the two remaining development mocks, and execute the signed-upload and live-challenge acceptance cases.

verification_evidence:
Production `main` commit `e9bd023f5b8314c2d22a2261930422be6d2946dc` deployed successfully as Worker version `a78953d6-899e-4a81-add5-646c9051c280`. The live Knowledge page shows the three supplied sources Ready and the seeded fixtures disabled. A fresh customer browser proved both website answers and citations, the exact manual answer plus `are you sure?` citation continuity, and the unsupported handoff. The final `pnpm check` passed formatting, lint, every workspace typecheck, all 135 tests, production builds, and the Worker dry run.

blockers:
None for the reported knowledge-repair goal. Broader full-G1 acceptance still requires R2 S3 signer credentials and hostname-bound Turnstile keys; P1/G2 retains its separately documented provider and device blockers.

decisions:
Decouple upload, crawl, and embeddings so one missing provider credential cannot silently force unrelated features into mock behavior. Use real OpenAI embeddings/chat for hosted retrieval, keep the current signed same-origin development upload adapter, use the specified Cloudflare `/crawl` REST provider with a least-privilege token, and contextualize only clearly dependent follow-ups.

files_changed:
Assistant-core retrieval/manual-answer logic and tests; API provider selection, crawl, retrieval, structured-output handling, tests, and generated bindings; Worker configuration; deployment/resource/status/decision documentation; and this progress ledger.

resume_instruction:
Read this ledger and current `git status`; reuse the existing signed-in Cloudflare and SmartService browser tabs when available. Resume `active_step`, never print secrets, and distinguish local, deployed, reprocessed, and live-answer evidence.

last_updated:
August 2, 2026
