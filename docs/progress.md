# SmartService Autonomous Delivery Progress

original_goal:
Repair hosted SmartService knowledge ingestion and retrieval so uploaded websites, documents, approved manual answers, and contextual follow-up questions work end to end.

scope_boundary:
Keep the locked Cloudflare/Supabase/OpenAI architecture, tenant isolation, citation validation, guardrails, and hosted-development boundary. Do not start R11, weaken refusal behavior, expose secrets, or disturb unrelated work.

human_gates:
On August 2, 2026, Forrest Zhang explicitly authorized the Project Lead to make all necessary product and technical decisions and complete the work. This authorizes one least-privilege Cloudflare Browser Run token, its Worker-secret storage, hosted-development deployment, source reprocessing, bounded provider calls, and live verification. Paid upgrades, production/customer data, destructive actions, and R11 remain outside this authorization.

current_phase:
Hosted knowledge retrieval, English output-guardrail reliability, customer-controlled handoff behavior, the restored-session escape, and the cost-optimized hybrid grounded-answer provider completed and accepted live.

active_step:
None for this repair. Hold at the separate full-G1 R2 signer and Turnstile resource boundary.

completed_steps:
Reproduced both hosted ingestion/retrieval failures, the later English course false handoff, the unintended automatic transfer after the Guzheng follow-up, and the restored pending-handoff dead end. Implemented and deployed split live providers, calibrated retrieval, contextual follow-ups, the current Browser Run contract, bounded GPT-5 reasoning, a deterministic cited path for exact approved manual answers, evidence-aware output supervision using only validated cited chunks, customer-controlled handoff behavior, a confirmed browser-tab-scoped New conversation action that retains the old support record, and Cloudflare-hosted GLM 4.7 Flash as the primary grounded-answer model with one validated `gpt-5-mini` fallback. Website v3 is Ready with 10 real documents and 65 OpenAI-embedded chunks; the supplied DOCX and manual answer are Ready with 13 and 1 chunks. Public chat now deduplicates concurrent polling/send results by message ID. Missing/conflicting/system-error responses remain AI-active, record canonical knowledge gaps for missing/conflicting evidence, and offer human support without claiming transfer; only explicit customer intent or safety/guardrail policy initiates handoff. Live acceptance passed English and Chinese GLM answers with citations, the three-case hosted music-school suite, the exact approved answer plus its contextual confirmation, and one unsupported case with `clarify` and zero handoff. The deployed chat bundle contains the localized restored-session escape and corrected no-auto-transfer notice. Three obsolete seeded demo sources were disabled, not deleted.

next_step:
When full G1 is resumed, provision bucket-scoped R2 signing credentials and hostname-bound Turnstile keys, replace the two remaining development mocks, and execute the signed-upload and live-challenge acceptance cases.

verification_evidence:
Production `main` commits `cea4630`, `b692cd1`, `8c6c684`, `e2fc06f`, and `dcab1c9` deployed successfully. Cloudflare deployment `2b211482-4e93-4577-a99e-a8bbbedd5a6c` promoted Worker version `26d502fe-d1fb-49d9-ac68-89b30123f113` to 100% with the real `AI` binding and hybrid model configuration; hosted migrations `20260803192827` and `20260803194616` match local source. Live smoke passed routes, health, runtime sign-in, 3/3 cited music-school answers, 1/1 AI-active safe clarification, and the localized New conversation asset checks. Separate English and Chinese course turns emitted successful GLM events and persisted `cloudflare-workers-ai`, the exact GLM model, token usage, and succeeded status in `ai_runs`; the manual-answer confirmation remained cited with no handoff. Direct hosted-state verification returned `active_ai`, `clarify`, zero handoffs, and one canonical `qa-500` knowledge-gap occurrence. The browser regression proves cancel, confirmed reset, fresh conversation creation, retained prior history, and no DELETE request. The final local suite passed formatting, zero-warning lint, every workspace typecheck, 143 tests, both fixed evaluations, production builds, the Worker dry run, and 20/20 database assertions. Remote database lint introduced no new errors; the only warning remains the pre-existing unused `p_request_id` parameter in `refresh_handoff_snapshot`. Direct rendered live-browser inspection of the New conversation action remained blocked by the browser administrator policy and was not bypassed.

blockers:
None for the reported knowledge-repair goal. Broader full-G1 acceptance still requires R2 S3 signer credentials and hostname-bound Turnstile keys; P1/G2 retains its separately documented provider and device blockers.

decisions:
Decouple upload, crawl, and embeddings so one missing provider credential cannot silently force unrelated features into mock behavior. Use real OpenAI embeddings, Cloudflare-hosted GLM 4.7 Flash as the primary grounded-answer model, and one `gpt-5-mini` fallback only after provider, schema, or exact-citation failure; keep the current signed same-origin development upload adapter, use the specified Cloudflare `/crawl` REST provider with a least-privilege token, and contextualize only clearly dependent follow-ups. Treat human transfer as a customer- or safety-controlled state transition, never as the default response to missing knowledge. Let customers leave any restored chat state through a confirmed tab-scoped reset while retaining the server conversation for Agent support and audit.

files_changed:
Assistant-core retrieval, manual-answer, evidence-aware guardrail, customer-controlled handoff, provider-result audit, and canonical-question logic/tests; API hybrid provider selection, Cloudflare Workers AI structured output, crawl, retrieval, output supervision, OpenAI fallback, and normalized gap metadata; public-chat message merging, handoff-choice, restored-session escape, and regression tests; non-terminal knowledge-gap migrations and database assertions; hosted acceptance tooling and evaluation policy; Worker AI binding/configuration; deployment/resource/status/decision documentation; and this progress ledger.

resume_instruction:
Read this ledger and current `git status`; reuse the existing signed-in Cloudflare and SmartService browser tabs when available. Resume `active_step`, never print secrets, and distinguish local, deployed, reprocessed, and live-answer evidence.

last_updated:
August 3, 2026
