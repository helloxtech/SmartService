# Shifa visit reports

The public synthetic demo is live at https://shifa.smartservice.ca as of October 29, 2026. Patient report sharing is disabled. The existing SmartService customer-service application is unchanged. Earlier entries below describe historical local validation.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shifa/web dev
pnpm --filter @shifa/web test
pnpm --filter @shifa/web typecheck
pnpm --filter @shifa/api build
```

Open `http://127.0.0.1:5180` and enter **1234**. This reserved code loads a public synthetic fixture locally: 24 measurement types over 180 days, 2,911 readings, paired blood pressure, measurement context, eight lab checkpoints, six ongoing concerns and 932 timeline events (401 symptom updates, 360 medication entries, 64 test events, 63 recorded actions, 26 notes and 18 visit summaries). It never retrieves a private patient's report.

For the real approval flow, first prepare the isolated database in `../shifa-api/README.md`. Then run `pnpm --filter @shifa/api dev:local` from the repository root. This server binds only loopback on port 8789 and uses synthetic keys. Never use real health data with this validation server. The Vite proxy forwards `/api/shifa` to it. The Carmen Debug simulator accepts the loopback-only `SHIFA_API_BASE_URL` environment override; Release uses the proposed HTTPS hostname.

## Product behavior

- One selected, frozen report can contain measurements, ongoing concerns, symptom updates, questions, test-result notes and medication events. No account is required.
- Patient previews the exact snapshot and explicitly agrees before upload. The temporary server snapshot is encrypted; ownership and doctor-request capabilities are separate. The four digits locate a pending request, not an unapproved report. The patient approves the matching phrase shown in the doctor's browser.
- Default expiry is 60 minutes; 15 and 240 minutes are available. Stop sharing revokes access and deletes the temporary report and linked requests. Expiry denies access immediately; server cleanup removes rows on the next call or five-minute scheduled sweep. Downloaded/printed/viewed copies cannot be recalled. Provider backups and retention need verification before production use; this implementation makes no claim of instantaneous backup erasure.
- Date range, source, context and aggregation filters operate on the selected snapshot. Calendar days use its timezone. Missing observations are gaps. Individual readings retain their recorded precision; summary means are rounded for display. Charts share a global histogram navigator with two resize handles, whole-window panning, 7/30/90-day shortcuts, date inputs and keyboard control. Point/period selection highlights every chart and filters the summary values, symptoms and raw records. Visuals support focus mode, drag ordering and accessible move buttons; the raw table provides exact values and keyboard selection.
- Symptom summary shows recorded onset, first/latest updates and patient questions, with a full timeline. It does not generate diagnoses or invent medication effects. `Print this view` prints the current report section; the original Carmen PDF/Word export remains available.
- Generic laboratory/custom measurements in the current Carmen app are factual test-result notes. The web schema and demo support numeric lab charts, but this does not imply native structured lab capture has been implemented.

## Verification and visual evidence

On October 28, 2026 PDT: 11 frontend tests (7 report-model and 4 date-window) and 5 API/PostgreSQL tests passed, along with scoped ESLint, strict typechecks, Vite build and Worker dry-run. Browser checks covered code 1234, date/source/context selection, raw-record point linkage, actual time-brush drag, actual chart reorder and a 390px viewport. A real simulator-to-local-API exercise showed only the approved selected BP/symptom snapshot and cleared the browser after patient revocation; SQL then contained zero shares and linked requests.

The visual baseline was rendered from Carmen's existing `DoctorReportPage` using synthetic records. The revised web implementation preserves the large paired BP chart, four clear summaries and restrained report typography. Compared with the generated design concept, the implementation uses explicit filter labels, all available metric categories, factual sample events instead of a named prescription, and no invented clinical target bands. Event detail and symptom summaries use recorded source text; switching interface language does not translate or rewrite patient entries.

Review artifacts are kept in this Codex task's `implementation` folder: `carmen-existing-report.png`, `shifa-redesigned-report.png`, `shifa-mobile-report.png`, `shifa-approved-local-report.png`, and `shifa-revoked.png`. These are local synthetic screenshots, not production evidence.

The chart module is lazy-loaded but still produces Vite's 500 kB chunk warning (about 196 kB gzip); the build passes. Hosted service credentials, encryption key, chosen database/region/retention, route/DNS and production authorization remain deployment prerequisites. Do not push `main` to bypass the existing Cloudflare deployment gate.

## Power BI interaction revision — October 28, 2026 PDT

Reviewed Microsoft's actual Developer Playground sample and official report screenshot, with a UI specialist and data-analysis review. References: [date slicers](https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-slicer-visual), [sample reports](https://learn.microsoft.com/en-us/power-bi/create-reports/sample-datasets), and [filtering/highlighting](https://learn.microsoft.com/power-bi/create-reports/power-bi-reports-filters-and-highlighting). This is a custom ECharts implementation; Microsoft Power BI is not embedded and full product parity is not claimed.

The revised canvas has a compact measurement rail, consistent summary cards, one dominant chart, comparison charts and same-period events. One shared date navigator controls all views. Aggregated tooltips show the actual mode, unit, paired values and sample count; partial weeks remain visible and selectable. Selection statistics use the same clipped period as the raw records. Missing dates stay gaps, units stay separate, and no clinical thresholds or inferred causation are introduced.

Browser verification exercised handle dragging, whole-range panning, keyboard adjustment, quick ranges, manual single-day input, source filtering, chart drag ordering, focus mode and linked raw records. The 390px viewport has no horizontal page overflow. New local synthetic review artifacts: `shifa-powerbi-overview.png`, `shifa-powerbi-selected.png`, `shifa-powerbi-mobile.png` in this task's `implementation` folder. Prior API/native test evidence is unchanged; this revision changes only the report frontend. Production deployment remains pending authorization and the prerequisites above.

## Expanded demo data — October 28, 2026 PDT

The user requested complete, rich sample content, especially symptom follow-up. All 24 measures now have observations in each 7/30/90-day preset. Six symptom scenarios include onset, changing severity, duration/context, recorded actions, visit notes and questions; each has a daily update throughout the most recent 30 days, so recent single-day selections remain useful. Morning/evening medication history includes recorded missed entries; lab values also appear as timeline events. These are synthetic scenarios only, with no real patient data, prescription or inferred diagnosis. Genuine report filtering and missing-data behavior remain unchanged.

Validation: 14 frontend tests, including three fixture-coverage tests for preset completeness, every recent day's symptom updates and valid event links. The browser was checked on Symptoms & medication and a single-day scope. This change is local, committed on the existing task branch, not pushed or deployed.

## Doctor-focused symptom visual review — October 29, 2026 PDT

Overview now shows the chosen primary measurement and event context; the full multi-chart comparison remains in Explore trends. Symptom follow-up uses a compact concern index (latest rated severity/date, first-to-latest values in the filtered period, patient question), one focused 0–10 severity plot and a second aligned grid for medication, tests, visits, recorded actions and notes. The same global date and source scope applies; symptom view omits measurement-only controls and the measurement sidebar.

Selecting a chart mark highlights the day and opens every matching event with its original time, source and detail. It does not change period-level concern summaries. The All symptom & event records tab includes every event in the current date/source scope, across concerns; Measurement records remains the numerical measurements view. Unassigned or unshared-concern symptoms have an explicit Other symptom records entry, shown as unconnected points. Unassigned non-symptom records remain contextual events, not presumed treatments for the focused symptom.

Severity values are neither averaged nor zero-filled. Gaps in report-local calendar days remain gaps; axes stay 0–10. Event markers group by local day and type and retain all events; hover previews are bounded, with complete details in the table. Both plots have identical horizontal bounds. Color and temporal proximity imply no diagnosis, urgency, treatment effect or causation.

Validation: 18 frontend tests, strict typecheck/build and scoped ESLint. Browser checks exercised concern switching, a test-day click (all 11 same-day records, including eight lab results), unchanged period summaries after selection, the complete 311-event 30-day table, source-filtered no-severity state, one-chart Overview versus four-chart Explore trends, and a 390px layout without page overflow. Screenshot: `shifa-symptom-visual-review.png` in this task's local implementation artifacts. The pre-existing chart chunk warning remains (~200 kB gzip); no new library or service was added. This is implemented/local-tested work, not a clinical validation or Production deployment.

## Unified English report — October 29, 2026

This supersedes the earlier separate Overview/Explore trends layout. Reports open on Health trends with four selected measurements; every selected metric has its own chart. Latest values and period statistics appear in each chart instead of duplicate selector cards. Patient symptom questions remain in the compact summary, linking to the complete symptom timeline. Symptoms & medication and Measurement records remain separate tabs. Shifa uses English only; the native Carmen language behavior is unchanged.

Validation: 18 frontend tests, scoped ESLint, typecheck/build, and desktop/mobile browser checks for selection, focus/restore, summary navigation, records and no horizontal overflow at 390px. Local screenshot: `shifa-health-trends-english.png` in this task's implementation artifacts. Local candidate only; not pushed or deployed.

## Simplified symptom review — October 29, 2026

Supersedes the earlier symbol-lane timeline: the chart now contains severity only, with descriptions in point tooltips. Selecting a point or recorded day shows symptom descriptions and a chronological text timeline of linked/unassigned events below. The full event records table remains available. Primary navigation contains Health trends and Symptoms & medication; measurement rows are secondary chart-level View data, with an explicit return preserving chart selections. Browser verified these flows and a 390px viewport; 19 frontend tests and build/typecheck/lint passed. Screenshot: `shifa-simple-symptoms.png` in local implementation artifacts. Not deployed.

## Public demo deployment

Run `pnpm --filter @shifa/api deploy:demo` only for an authorized deployment. This builds the English demo-only entry and deploys the isolated Worker/custom domain. `SHIFA_DEMO_ONLY=true` explicitly rejects patient API requests; no database credentials or scheduled cleanup are configured in this demo release. Do not enable real sharing without configuring and verifying its database, encryption key, retention and cleanup schedule. Live version `03efc0ec-f7ff-4615-bc98-ec9848d0c13a` was verified with code 1234, equal charts, focus/restore and selected-day symptom details; source integration remains pending.
