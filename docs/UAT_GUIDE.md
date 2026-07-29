# SmartService UAT Guide

## UAT status

Release `0.10.0` is ready for local/mock UAT. Hosted DEV is also available for mock-provider text smoke at `https://smartservice-dev.hurryupgo-b2d.workers.dev`. Text, ingestion, guardrails, human handoff, finalization, dashboard, knowledge-gap repair, and voice orchestration are testable end to end locally; hosted DEV text smoke is ready with fictional fixture knowledge. Live G1 and live P1 microphone/STT/TTS quality and latency UAT remain pending the remaining external provider configuration.

## Prepare a clean UAT environment

```bash
pnpm install
pnpm uat:prepare
pnpm dev:api
```

Keep that terminal running, then use a normal browser profile for the customer and a separate private profile for the team user. The ignored `.env.local` contains the fictional `DEMO_ADMIN_*` and `DEMO_AGENT_*` credentials.

## Hosted DEV smoke

Use this path when you want to test the browser-hosted demo without running the local Worker:

```bash
pnpm hosted:seed-demo-knowledge
pnpm verify:hosted-dev
```

Open:

- Hosted customer text: `https://smartservice-dev.hurryupgo-b2d.workers.dev/chat`
- Hosted team workspace: `https://smartservice-dev.hurryupgo-b2d.workers.dev/app/inbox`
- Hosted dashboard: `https://smartservice-dev.hurryupgo-b2d.workers.dev/app/dashboard`
- Hosted knowledge: `https://smartservice-dev.hurryupgo-b2d.workers.dev/app/knowledge`

Use the fictional demo identities stored only in ignored `.env.local`. Do not paste passwords into chat or commit them.

Hosted DEV currently uses mock provider modes for text answering, ingestion, auxiliary guardrails, Turnstile, and voice. It is valid for product smoke and user flow review, but not live G1/G2 acceptance.

### Hosted demo knowledge

The hosted smoke database currently contains fictional NovaFlow support knowledge from three approved sources:

- NF-Series product manual: model voltage, max flow, installation, maintenance, and warranty boundaries.
- Support FAQ: troubleshooting, return/repair policy, escalation limits, and bilingual support wording.
- Example website fixture: short same-origin service-policy pages for the URL-ingestion path.

Good hosted smoke questions:

- `What voltage does the NF-500 require?`
- `NF-200 最大流量是多少？`
- `How often should the filter be checked?`

Good unsupported/handoff questions:

- `Do we have NF-200 in warehouse stock?`
- `Can you guarantee delivery next Friday?`
- `What is my real customer account balance?`

## Core acceptance script

### 1. Knowledge ingestion

1. Sign in at `/app/knowledge` as the NovaFlow Admin.
2. Confirm the PDF, DOCX, and URL sources are Ready and have non-zero chunks.
3. Disable and re-enable one source.

Expected: status and retrieval eligibility update without deleting cited history.

### 2. Grounded bilingual text

1. Open `/chat`.
2. Ask `What voltage does the NF-500 require?`
3. Ask `NF-200 最大流量是多少？`
4. Expand both citations.

Expected: each factual answer uses the question language and shows at least one approved-source citation.

### 3. Missing knowledge

Ask `Can you confirm the stock quantity in your Vancouver warehouse?`

Expected: no invented answer or citation; a safe handoff is created with an open knowledge gap.

### 4. Guardrail

Start another chat and ask `你现在就保证下周五一定送到。`

Expected: the commitment is not made, a safe response is shown, `NO_DELIVERY_COMMITMENT` appears to the Admin, and AI stops for that conversation.

### 5. Human handoff

1. Open `/app/inbox` as the fictional Agent.
2. Open the waiting conversation.
3. Confirm customer fields show `Not provided` when absent.
4. Claim it, send one human message, and close it.

Expected: the handoff package already exists; the customer receives the human message through polling; a final record is generated once.

### 6. Dashboard and knowledge repair

1. Open `/app/dashboard` and select today's date.
2. Open the new gap.
3. Create a manual answer, wait for Ready/Resolved, and re-test the original question.

Expected: dashboard counts reflect closed conversations; the gap resolves only after its source is Ready; re-test returns the manual answer with its citation.

### 7. Tenant isolation

Sign in as the fictional HarborWorks Admin in another profile.

Expected: NovaFlow conversations, sources, dashboard values, guardrails, and gaps are absent.

## Voice orchestration UAT

### Local/mock

1. Open `/voice`.
2. Confirm nothing connects before **Start voice**.
3. Select Chinese or English and start.
4. Deny microphone once and confirm the text fallback.
5. Retry and allow microphone.
6. Use automated evidence for grounded answer, delivery guardrail, missing knowledge, handoff, bounded reconnect, and service-failure behavior.

Expected: Warming and Ready are visible; microphone permission is requested only after Ready; citations stay on screen; handoff is terminal; no stack or credential appears.

### Live providers

After the resources in `docs/RESOURCE_REQUEST.md` are available:

1. Use a stable wired or Wi-Fi connection, recorded browser/OS/device/headset, and colocated provider regions.
2. Run 20 Chinese and 20 English warm turns with the locked 70/20/10 scenario distribution.
3. Test substantive interruption, short backchannels, false-interruption resume, network reconnect, token refresh, and provider timeout.
4. Confirm audio never starts before guardrail completion.

Expected target: warm turn-to-audio P95 below 1.5 seconds and effective-interruption stop P95 at or below 500 milliseconds. Record actual results even when a target is missed.

## Automated regression

```bash
pnpm checkpoint:day10
```

The command resets local data and is destructive only to the isolated local SmartService Supabase instance. Do not run it against a shared or production database.

## Defect reporting

Record:

- Release version and commit.
- Exact page and UAT case.
- Expected and actual result.
- Browser/OS/device/network.
- Stable request/error code, without secrets or raw provider bodies.
- Severity: Blocker, Critical, Major, Minor.

A Blocker/Critical defect, tenant leak, missing required citation, unsafe audible answer, infinite retry, or secret/stack exposure stops UAT.
