# P0 Demo Script

## Purpose

Run the complete SmartService text-service loop in 5–7 minutes without production data or paid provider calls. The fixed local identities and passwords remain in `.env.local`; never display them during the demo.

## Preparation

From a clean local database, prepare the three required source types and build the application:

```bash
pnpm db:reset
pnpm bootstrap:local
pnpm check
pnpm verify:ingestion
pnpm dev:api
```

Open `http://127.0.0.1:8787` in two browser profiles:

- Customer profile: `/chat`
- Team profile: `/app/dashboard`, signed in as the fictional XFlow Admin

Keep the fictional XFlow Agent available in a third private profile. The HarborWorks Admin is the backup organization for the isolation proof.

## Main 5–7 minute flow

### 0:00–0:45 — Approved knowledge

1. Open **Knowledge** as the XFlow Admin.
2. Show the Ready PDF, DOCX, and bounded same-origin website sources.
3. State that source content is tenant-scoped, versioned, and treated as untrusted data.

Expected: all three source types are Ready and have non-zero chunks.

### 0:45–1:30 — Grounded bilingual answer

1. Open customer chat.
2. Ask: `What voltage does the NF-500 require?`
3. Expand the returned citation.
4. Ask in Chinese: `NF-200 最多可以连续运行多久？`

Expected: concise answers in the question language; every factual answer has an approved-source citation.

### 1:30–2:15 — Safe missing-knowledge handoff

Use one unused question for each consecutive demo run:

| Run | Customer question | Approved answer entered later |
|---|---|---|
| 1 | `What is the diagnostic coverage window?` | `The approved diagnostic coverage window is 14 days.` |
| 2 | `What is the calibration review window?` | `The approved calibration review window is 21 days.` |
| 3 | `What is the replacement inspection window?` | `The approved replacement inspection window is 10 days.` |

Expected: SmartService refuses to invent an answer, creates one grouped open gap, and requests human support without citations.

### 2:15–3:15 — Human takeover and close

1. Open **Inbox** as the XFlow Agent.
2. Open the handoff and show the question, known customer fields, trigger, next step, transcript, and citations.
3. Select **Take over**.
4. Send: `I have taken over and will confirm the approved policy for you.`
5. Confirm the customer sees the human message, then close the conversation.

Expected: AI writes stop after takeover; public polling still receives human and closure messages; the final record is queued.

### 3:15–4:15 — Exact dashboard

1. Return to **Dashboard** as the XFlow Admin.
2. Apply a date range containing today.
3. Show total closed conversations, AI containment, handoff rate, and unresolved knowledge gaps.
4. Explain that rates use closed conversations as the denominator and that the date range is inclusive in the UI.

Expected: the just-closed handoff changes the total/handoff metrics and the open-gap count.

### 4:15–5:45 — One-click knowledge repair

1. Open **Knowledge gaps**.
2. Select the question from this run and show its occurrence count, example conversation, reason, and Open status.
3. Enter a short title and the approved answer from the table above.
4. Add source note: `Approved fixed P0 demo policy.`
5. Select **Create and embed knowledge** and wait for Ready/Resolved.
6. Select **Re-test original question**.

Expected: a manual source is queued through the shared ingestion pipeline; the gap resolves only after embedding is Ready; the re-test returns the exact approved answer with a manual-source citation.

### 5:45–6:30 — Security and audit close

1. Sign in as the HarborWorks Admin in the backup profile.
2. Open Dashboard and Knowledge gaps.
3. Confirm the XFlow conversation, metrics, and gap are absent.
4. State that the run used deterministic local providers and made no paid calls.

Expected: the second organization sees only its own empty/demo state.

## Three-consecutive-run record

Do not mark G1 ready until all three rows are completed without a Blocker/Critical defect.

| Run | Question | Started | Completed | Result | Notes |
|---|---|---|---|---|---|
| 1 | Diagnostic coverage | 2026-07-27 00:23:12 PDT | 2026-07-27 00:24:27 PDT | Passed | Fresh reset; full local ingestion, conversation, guardrail, handoff, analytics, repair, citation, and isolation chain |
| 2 | Calibration review | 2026-07-27 00:24:27 PDT | 2026-07-27 00:25:41 PDT | Passed | Fresh reset; independent manual-answer case; zero provider cost |
| 3 | Replacement inspection | 2026-07-27 00:25:41 PDT | 2026-07-27 00:26:55 PDT | Passed | Fresh reset; independent manual-answer case; no Blocker/Critical defect |

All three runs were executed by Codex with `SMARTSERVICE_DEMO_CASE=<case> pnpm demo:p0:run`.

## Recovery

- If the local state is unclear, stop the demo and rerun Preparation. Do not repair rows manually.
- If a source remains Processing for 60 seconds, use its visible failure state and retain Worker diagnostics; do not claim success.
- If the main XFlow profile cannot sign in, use the HarborWorks profile only to demonstrate isolation, then stop. It is not a substitute for the primary P0 flow.
- If a live-provider demo is later approved, retain this local deterministic path as the zero-cost fallback and label it clearly.
