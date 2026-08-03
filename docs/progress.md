# SmartService Autonomous Delivery Progress

original_goal:
Repair hosted SmartService knowledge ingestion and retrieval so uploaded websites, documents, approved manual answers, and contextual follow-up questions work end to end.

scope_boundary:
Keep the locked Cloudflare/Supabase/OpenAI architecture, tenant isolation, citation validation, guardrails, and hosted-development boundary. Do not start R11, weaken refusal behavior, expose secrets, or disturb unrelated work.

human_gates:
On August 2, 2026, Forrest Zhang explicitly authorized the Project Lead to make all necessary product and technical decisions and complete the work. This authorizes one least-privilege Cloudflare Browser Run token, its Worker-secret storage, hosted-development deployment, source reprocessing, bounded provider calls, and live verification. Paid upgrades, production/customer data, destructive actions, and R11 remain outside this authorization.

current_phase:
Hosted knowledge retrieval, humanized multi-intent answers, exact-entity safeguards, customer-controlled handoff behavior, the restored-session escape, and GLM primary-model testing with GPT answer fallback temporarily disabled completed and accepted live.

active_step:
None for this repair. Hold at the separate full-G1 R2 signer and Turnstile resource boundary.

completed_steps:
Reproduced both hosted ingestion/retrieval failures, the later English course false handoff, the unintended automatic transfer after the Guzheng follow-up, the restored pending-handoff dead end, the Guqin/Guzheng entity substitution, robotic missing-knowledge copy, multi-question retrieval dilution, partial-answer supervisor false positive, and one transient primary-model Structured Output failure. Implemented and deployed split live providers, calibrated retrieval, contextual follow-ups, focused multi-intent retrieval, Chinese-to-English search hints with audited lower thresholds, exact-entity filtering, interleaved evidence, natural missing-field wording, exact-page citation URLs, a same-GLM retry, the current Browser Run contract, bounded GPT-5 reasoning, a deterministic cited path for exact approved manual answers, evidence-aware output supervision using only validated cited chunks, customer-controlled handoff behavior, a confirmed browser-tab-scoped New conversation action that retains the old support record, and Cloudflare-hosted GLM 4.7 Flash as the primary grounded-answer model with one validated `gpt-5-mini` fallback that remains disabled for current testing. Website v3 is Ready with 10 real documents and 65 OpenAI-embedded chunks; the supplied DOCX and manual answer are Ready with 13 and 1 chunks. Missing/conflicting/system-error responses remain AI-active, record canonical knowledge gaps for missing/conflicting evidence, and offer human support without claiming transfer; only explicit customer intent or safety/guardrail policy initiates handoff. Live acceptance passed the final Guqin three-turn sequence with zero handoffs and the exact four-part school question with cited 2001/founder/address facts plus explicit current-principal and home/online limitations. The deployed chat bundle contains the localized humanized readiness/busy copy. Three obsolete seeded demo sources were disabled, not deleted.

next_step:
When full G1 is resumed, provision bucket-scoped R2 signing credentials and hostname-bound Turnstile keys, replace the two remaining development mocks, and execute the signed-upload and live-challenge acceptance cases.

verification_evidence:
Production `main` commits `cea4630`, `b692cd1`, `8c6c684`, `e2fc06f`, `dcab1c9`, `d0a331f`, `a4aa700`, `9514682`, `b808833`, `48fc94d`, and `20b0c56` deployed successfully. Functional Worker version `a1e1cec8-9a30-47f0-b4bb-20604fd9b36a` retains the real `AI` binding, `workers-ai` primary, and fallback `none`. Two consecutive exact compound questions persisted successful `cloudflare-workers-ai` / `@cf/zai-org/glm-4.7-flash` answer runs, returned cited 2001/founder/address facts, explicitly left current principal and home/online mode unconfirmed, remained `active_ai`, and created no handoff. The final Guqin availability/repeat/fee sequence returned three natural `clarify` answers, no Guzheng substitution, zero citations, and zero handoffs. The exact About-page citation now links to `/canada-yc-music-academy/`, and the deployed chat asset contains the humanized Chinese/English readiness and busy copy. The final complete gate passed formatting, zero-warning lint, every workspace typecheck, 155 tests, both fixed evaluations, production builds, and the Worker dry run. Direct rendered live-browser inspection remains blocked by the browser administrator policy and was not bypassed.

blockers:
None for the reported knowledge-repair goal. Broader full-G1 acceptance still requires R2 S3 signer credentials and hostname-bound Turnstile keys; P1/G2 retains its separately documented provider and device blockers.

decisions:
Decouple upload, crawl, and embeddings so one missing provider credential cannot silently force unrelated features into mock behavior. Use real OpenAI embeddings and Cloudflare-hosted GLM 4.7 Flash as the primary grounded-answer model; keep the tested `gpt-5-mini` answer fallback configurable but set it to `none` during primary-model evaluation so failures clarify safely instead of calling OpenAI. Use one same-GLM retry after primary provider/schema/citation failure so attribution remains unambiguous. Split bounded multi-question turns, preserve the original Chinese text while adding English search hints, lower the threshold only for those expanded queries, interleave evidence across parts, and require exact Guqin/Guzheng matches. Treat accurate missing-field language as a limitation rather than an unsupported claim, keep internal retrieval terminology out of customer copy, link URL citations to the exact crawled page, and treat human transfer as a customer- or safety-controlled state transition rather than the default response to missing knowledge. Let customers leave any restored chat state through a confirmed tab-scoped reset while retaining the server conversation for Agent support and audit.

files_changed:
Assistant-core retrieval, manual-answer, evidence-aware guardrail, customer-controlled handoff, provider-result audit, and canonical-question logic/tests; API hybrid provider selection, Cloudflare Workers AI structured output, crawl, retrieval, output supervision, OpenAI fallback, and normalized gap metadata; public-chat message merging, handoff-choice, restored-session escape, and regression tests; non-terminal knowledge-gap migrations and database assertions; hosted acceptance tooling and evaluation policy; Worker AI binding/configuration; deployment/resource/status/decision documentation; and this progress ledger.

resume_instruction:
Read this ledger and current `git status`; reuse the existing signed-in Cloudflare and SmartService browser tabs when available. Resume `active_step`, never print secrets, and distinguish local, deployed, reprocessed, and live-answer evidence.

last_updated:
August 3, 2026
