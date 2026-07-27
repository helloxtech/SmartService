# SmartService UAT Readiness Report

**Release candidate:** `0.10.0`

**Snapshot:** July 27, 2026

**Local status:** Local/mock UAT-ready

**Live voice status:** Live P1 UAT pending

## Executive result

SmartService Days 1–10 are implemented for the locked P0 and P1 prototype scope. The complete local deterministic path is green, uses fictional data, and has recorded provider cost of USD 0. The project is ready for user acceptance of functionality and UX in the local/mock environment.

Hosted P0 behavior and live P1 microphone, STT, TTS, interruption, and latency cannot be accepted until the external development projects, credentials, provider regions, voice ID, and device/network matrix are available. No result in this report converts mock timing into live evidence.

## Requirement status

| Area | Evidence | Status |
|---|---|---|
| P0 ingestion | PDF, DOCX, bounded same-origin URL; 3 Ready sources and 20 chunks | Local green |
| Grounded text | 12/12 fixed in-scope cited; 8/8 unsupported handed off | Local green; live model pending |
| Guardrails | 6/6 rules plus voice delivery inducement | Local green; live supervisor pending |
| Human loop | Handoff package, takeover, human polling, close, finalization | Local green |
| Dashboard/gaps | Exact metrics, grouped gaps, one-click repair, cited re-test | Local green |
| Voice startup | Explicit click, Warming, Ready, microphone gate, text fallback | Local green; live WebRTC pending |
| Voice RAG/TTS boundary | Exact text/voice parity, bounded speech, screen citations, no audio before approval | Local green; live quality pending |
| Turn/interruption | Multilingual detector, adaptive settings, false-resume, preemptive TTS off | Configuration/tests green; live interruption pending |
| Voice latency | 40 retained local traces, 20/20 languages, 28/8/4 scenarios, nearest-rank report | Local orchestration only; live G2 ineligible |
| Voice handoff/recovery | Guardrail/missing handoff, AI stop, bounded reconnect, timeout/failure fallback | Local green; live network/provider pending |
| Tenant/security | Forced RLS, negative tenant tests, service boundaries, redacted errors | Local green |

## Automated evidence

- Full repository format, lint, strict typecheck, tests, builds, Worker dry run, Playwright, database assertions, database lint, P0 evaluation, guardrail evaluation, and Days 2–10 smokes.
- Three independent full local P0/P1 demo chains from fresh resets: diagnostic, calibration, and replacement.
- Raw local voice traces and summary: `docs/evidence/day8-local-voice-report.json`.
- Three-run record: `docs/evidence/day10-local-demo-runs.json`.
- No live provider call or paid resource action was made.

## Known limitations

- No hosted development URL exists in the current evidence bundle.
- OpenAI, Cloudflare hosted services, Supabase hosted behavior, Turnstile, LiveKit, Deepgram, and ElevenLabs have not been exercised with project credentials.
- Local voice timing ends at a mock playback callback and is explicitly not browser/provider G2 evidence.
- Live Chinese/English recognition, pronunciation, semantic backchannel quality, real interruption stop latency, and reconnect behavior remain device/provider tests.
- The prototype does not claim production HA, SLA, load, compliance, or production security approval.

## Defect and gate posture

- Known local Blocker/Critical defects: none after the complete Day 10 checkpoint.
- Architecture deviations: none from the locked modular-monolith/provider design.
- Provider cost recorded: USD 0.
- R11 remains disabled. G2 has not received live user acceptance, so G3 entry conditions are not met; no ticket schema, pipeline, list, or UI was added.

## UAT entry decision

Proceed with local/mock UAT using `docs/UAT_GUIDE.md`. Provision the remaining development resources before live G1/G2 acceptance. Production deployment and R11 remain separate decisions.
