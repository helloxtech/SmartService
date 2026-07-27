# P0 Evaluation Report

**Snapshot:** July 27, 2026

**Gate:** Local G1 evidence complete; hosted evidence pending

**Conclusion:** P0 is locally UAT-ready with deterministic providers. Hosted-provider G1 claims remain blocked by missing external credentials.

## Requirement evidence

| Requirement | Current evidence | State |
|---|---|---|
| R1 ingestion | Real-browser PDF, DOCX, and bounded same-origin website ingestion previously reached 3 Ready sources and 20 enabled embedded chunks | Local green |
| R2 grounded text Q&A | Fixed deterministic evaluation returned cited answers for 12/12 in-scope questions and safe missing-knowledge handoff for 8/8 out-of-scope questions | Local green; live model pending |
| R3 guardrails | All 6/6 fixed rules blocked with the expected rule and safe handoff; blocked candidates stayed Admin-only | Local green; live supervisor pending |
| R4 human handoff | Day 4 smoke proved handoff under 3 seconds, AI stop after takeover, human polling under 3 seconds, and audited closure | Local green |
| R5 final record | ID-only Queue finalization produced summary, intent, follow-up actions, next step, and suggested wording with R11 disabled | Local green |
| R6 dashboard and gaps | Day 5 smoke proved exact `+2` closed-handoff metric deltas, 2-occurrence gap grouping, Admin/tenant denial, manual source readiness, and cited re-test | Local green |

## Day 5 evidence produced in this slice

- The eighth ordered P0 migration applies successfully from a clean reset.
- Database tests pass 109/109 assertions across tenant, role, privacy, ingestion, conversation, citation, guardrail, handoff, finalization, dashboard, gap, idempotent actions, and audit boundaries.
- API tests include validated date ranges, grouped list/detail, strict actions, idempotent resolution, cited re-test, and Admin denial.
- Web tests cover dashboard metrics, one-click manual knowledge, and displayed re-test citations.
- OpenAPI YAML parses with the implemented dashboard and gap contracts.
- The zero-cost end-to-end Day 5 smoke passes through the real local Worker, Auth, Queue, R2 binding, and Supabase.
- No cost-bearing provider call was made; recorded project provider cost remains USD 0.

## Completed local G1 evidence

1. The full composite command passed in one uninterrupted run:

   ```bash
   pnpm checkpoint:day5
   ```

2. Three consecutive clean-reset demo runs passed using the diagnostic, calibration, and replacement cases recorded in `docs/P0_DEMO_SCRIPT.md`.
3. Forrest Zhang explicitly authorized automatic continuation through Day 10 on July 27, 2026, so P1 implementation may proceed without pausing at the review gate.

## Hosted evidence still required for a live G1 claim

1. Provision and verify the approved hosted P0 Supabase, Cloudflare/R2/Queue/Browser Run/Turnstile, and OpenAI resources.
2. Produce a non-production deployed demo URL and hosted smoke evidence.
3. Review the hosted limitations before representing G1 as live-provider accepted.

## Known limitations

- Current model-quality evidence is deterministic and does not claim hosted OpenAI answer quality.
- Current crawl, storage, queue, and abuse-control evidence is local; hosted-provider behavior remains unverified.
- No production deployment or production data is authorized.
- R11 remains disabled and no ticket schema or UI was introduced.
- P1 may proceed under the user's explicit automatic-continuation instruction, but this does not convert local mock evidence into hosted G1 evidence.
