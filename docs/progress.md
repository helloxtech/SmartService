# SmartService Autonomous Delivery Progress

original_goal:
Repair hosted SmartService knowledge ingestion and retrieval so uploaded websites, documents, approved manual answers, and contextual follow-up questions work end to end.

scope_boundary:
Keep the locked Cloudflare/Supabase/OpenAI architecture, tenant isolation, citation validation, guardrails, and hosted-development boundary. Do not start R11, weaken refusal behavior, expose secrets, or disturb unrelated work.

human_gates:
On August 2, 2026, Forrest Zhang explicitly authorized the Project Lead to make all necessary product and technical decisions and complete the work. This authorizes one least-privilege Cloudflare Browser Run token, its Worker-secret storage, hosted-development deployment, source reprocessing, bounded provider calls, and live verification. Paid upgrades, production/customer data, destructive actions, and R11 remain outside this authorization.

current_phase:
Hosted knowledge retrieval and English output-guardrail reliability completed and accepted live.

active_step:
None for this repair. Hold at the separate full-G1 R2 signer and Turnstile resource boundary.

completed_steps:
Reproduced both hosted ingestion/retrieval failures and the later English course false handoff. Implemented and deployed split live providers, calibrated retrieval, contextual follow-ups, the current Browser Run contract, bounded GPT-5 reasoning, a deterministic cited path for exact approved manual answers, and evidence-aware output supervision using only validated cited chunks. Website v3 is Ready with 10 real documents and 65 OpenAI-embedded chunks; the supplied DOCX and manual answer are Ready with 13 and 1 chunks. Public chat now deduplicates concurrent polling/send results by message ID. Live customer acceptance passed 3/3 fresh English course answers, one Chinese course answer, the approved answer plus `are you sure?`, and an unsupported inventory handoff. Three obsolete seeded demo sources were disabled, not deleted.

next_step:
When full G1 is resumed, provision bucket-scoped R2 signing credentials and hostname-bound Turnstile keys, replace the two remaining development mocks, and execute the signed-upload and live-challenge acceptance cases.

verification_evidence:
Production `main` commits `d69ae21` and `3862e48` deployed successfully, with final functional Worker version `84425727-19ac-4020-a01c-867de5d2c24e`. The live audit identified the original English failure as `NO_UNSUPPORTED_CLAIM` false-positive supervision, not missing retrieval. Three post-fix English conversations each returned one answer with five citations and no handoff; the Chinese course question returned one cited Chinese answer; the unsupported inventory question handed off without citations. The final `pnpm check` passed formatting, zero-warning lint, every workspace typecheck, all 137 tests, production builds, and the Worker dry run.

blockers:
None for the reported knowledge-repair goal. Broader full-G1 acceptance still requires R2 S3 signer credentials and hostname-bound Turnstile keys; P1/G2 retains its separately documented provider and device blockers.

decisions:
Decouple upload, crawl, and embeddings so one missing provider credential cannot silently force unrelated features into mock behavior. Use real OpenAI embeddings/chat for hosted retrieval, keep the current signed same-origin development upload adapter, use the specified Cloudflare `/crawl` REST provider with a least-privilege token, and contextualize only clearly dependent follow-ups.

files_changed:
Assistant-core retrieval, manual-answer, and evidence-aware guardrail logic/tests; API provider selection, crawl, retrieval, output supervision, structured-output handling, tests, and generated bindings; public-chat message merging and tests; Worker configuration; deployment/resource/status/decision documentation; and this progress ledger.

resume_instruction:
Read this ledger and current `git status`; reuse the existing signed-in Cloudflare and SmartService browser tabs when available. Resume `active_step`, never print secrets, and distinguish local, deployed, reprocessed, and live-answer evidence.

last_updated:
August 3, 2026
