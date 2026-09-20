---
slug: excel-daily-summary
title: Nightly Excel High School activity scrape + phone-readable daily summary
status: approved
created: 2026-09-20
---

# Plan: excel-daily-summary

## Goal / Approach

Each morning the parent opens a GitHub Pages URL on their phone and sees a
summary of the prior day's learning activity on the Excel High School
(LearnStage) platform — estimated active minutes per course, session
timeline, event counts, and quiz submissions. A nightly GitHub Actions job
(cron) logs in with a Playwright script, clicks "Login as" and "My
Courses", scrapes the Recent Activity container, parses it, merges the
events into committed per-day JSON (`data/YYYY-MM-DD.json`), and the static
`index.html` renders a "yesterday" card plus a history scroll. The repo is
static-only: no backend, credentials live in an Actions secret. The parent
account is the login; the "Login as" step impersonates the student
(`data-id` from the Login-as button selects the student).

Time-on-activity is estimated: the feed carries event timestamps only, so
duration = gap between consecutive events, with a 30-min idle cap splitting
sessions and excluded gaps not counted as active time.

## Acceptance Criteria

1. **Scrape script end-to-end locally** — given live credentials via env
   (EXCEL_USERNAME, EXCEL_PASSWORD) and the student data-id in
   `config.json`, `node scrape.js` exits 0 and writes
   `data/raw-events.json` with `events[]` fields: `at` (ISO from feed
   timestamp), `kind` (page_viewed | quiz_viewed | quiz_submitted |
   other), `item` (title), `course` (from folder label). Verifier: exit
   code 0 + `node -e "require('./data/raw-events.json').events.length > 0"`.
   This criterion requires the user present once with live credentials.
2. **Parser handles the real DOM shape** — against a fixture of the pasted
   Recent Activity HTML (`tests/fixtures/recent-activity.html`), `node
   tests/parse.test.js` asserts: ≥16 events parsed from the fixture; each
   has item/course/kind/timestamp; the `Module 1 Quiz` pair yields one
   `quiz_submitted` at 2026-09-17T21:21:19 and one `quiz_viewed` at
   21:16:40; `Media Arts EHS` and `World History EHS` course assignments
   correct; untyped icons do not crash the parser (fallback kind `other`).
3. **Idle cap / session split logic** — `tests/summarize.test.js`
   table-driven cases: a 29-min gap counts; a 31-min gap splits sessions
   and contributes 0 active minutes; a day with one course only emits one
   `by_course` entry; multiple logins in one day produce ≥2 sessions.
   Verifier: `node tests/summarize.test.js` exits 0.
4. **Per-day data file written and merged idempotently** — running
   `node summarize.js data/raw-events.json` (after fetch-merge of prior
   `data/*.json`) writes `data/2026-09-17.json` matching the agreed schema
   (date, first/last_activity_at, span_minutes,
   estimated_active_minutes, sessions[], by_course[], event_counts{},
   submissions_and_grades[]); re-running with the same events produces a
   byte-identical file (duplicate events from cumulative feed snapshots
   do not doublecount — events are deduped on item+kind+timestamp).
   Verifier: second run `git diff --exit-code -- data/`.
5. **Pages site renders** — `index.html` fetches all `data/*.json`
   (fetched via a build-time-generated `data/index.json` manifest since
   Pages cannot list a directory), renders the most recent day as a top
   card (date, "active (span)" line, per-course minutes bars, submissions
   list) plus a history scroll of earlier days. Verifier: Playwright
   opens `index.html` served locally (`npx serve .`) against the fixture
   day JSON; asserts the card title contains the date, active-minutes
   text is present, and both course names appear — `npm test` includes
   this.
6. **Stale-data safety** — when the scrape fails (non-zero exit in the
   workflow) nothing in `data/` is modified; the page shows its most
   recent day plus the `generated_at` timestamp from that day's file.
   Verifier: unit test asserts summarize exits non-zero on empty/invalid
   events without writing any file; index.html renders the `data_as_of`
   line from the loaded day JSON (fixture test).
7. **Workflow wiring** — `.github/workflows/daily.yml` schedules at
   06:00 America/Chicago (13:00 UTC, after the student's prior-day
   evening sessions), runs scrape → summarize → commit `data/` → pages
   deploy; pushes with a standard `GITHUB_TOKEN` (`permissions: contents:
   write`); credentials read only from secrets `EXCEL_USERNAME` /
   `EXCEL_PASSWORD`; workflow exits non-zero on scrape failure.
   Verifier: manual review of the YAML + one pushed commit; first live
   run observed green.
8. **Pages published** — repo settings Pages enabled on `main /
   (root deploy via actions)`; visiting the published URL shows the
   summary page from AC 5. User checks this from their phone (manual
   verification step at handoff).

## Files to Modify

- scrape.js — new; Playwright (chromium) flow: goto login URL → fill
  credentials → Login as (button with student data-id from config.json)
  → click "My Courses" sidebar link → wait for `#scrollableDiv` →
  scroll-burst loop (~10 bursts) to extend infinite scroll → dump
  container HTML + parsed events to data/raw-events.json. Fails loud
  (non-zero) if final page lacks the scrollable container.
- parse.js — pure parser: feed container HTML → events[]; kind inference
  from SVG id (QuizIcon) + text ("Viewed"/"Submitted"); timestamp from
  the dd/mm text; no Playwright dependency (testable).
- summarize.js — dedupe + merge fetched prior-day JSONs, session split
  (idle cap constant IDLE_MINUTES=30), per-course rollup, writes
  data/YYYY-MM-DD.json + data/index.json manifest; exits non-zero
  without writing on empty input.
- index.html — new; no framework: fetch manifest → fetch day JSONs →
  render yesterday card + history scroll; explicit "data as of" line.
- config.json — student data-id; committed (no secret material).
- .github/workflows/daily.yml — cron 0 13 * * *, node 22, npm ci,
  playwright install --with-deps chromium, run scrape/summarize, commit
  data/ (only if diff), deploy Pages.
- package.json — playwright, npx serve as test dep; scripts: scrape,
  test.
- tests/parse.test.js, tests/summarize.test.js, tests/page.spec.js — new;
  plain-node asserts + one Playwright page test.
- tests/fixtures/recent-activity.html — new; sanitized copy of the
  parent-pasted container HTML.

## Scope

**Included**
- Scrape (login → Login as → My Courses → Recent Activity), parse,
  summarize, per-day JSON data model, static Pages viewer with history,
  nightly workflow with secrets, failure-safe stale display.

**Excluded**
- Multi-child support beyond the one configured data-id (structure keeps it trivial later).
- Grades/scores numerals (feed shows submission events only; per-quiz score pages not scraped).
- Notifications (email/push when a day is empty or a quiz is submitted).
- Any attempt to backfill history older than what the feed currently exposes.
- Mobile app / PWA features (installable, offline) — plain viewport-fit page is enough.
- Rerunning missed days manually; a day with no run simply has no file.

## Schema / Type Impacts

None. Data is flat JSON files under data/ (schema documented in this
plan's AC 4); no database, no generated types.

## Verification

- node tests/parse.test.js
- node tests/summarize.test.js
- npm test   # includes the Playwright index.html render test
- Live one-time check (user present with credentials in env): node scrape.js
- First scheduled run in GitHub Actions: green; published Pages URL
  checked on phone.

## Open Questions

1. Idle cap 30 min — OK as chosen? Default: yes, constant IDLE_MINUTES=30
   in summarize.js.
2. Feed scroll depth — burst count 10; if fewer items land than expected,
   raise in a follow-up. Default: 10.
3. Run timezone — 13:00 UTC ≈ 7–8am Central. Default: 0 13 * * *.
4. Repo name/hosting — publishing user account vs org; default: user
   account, public repo (data contains only activity titles/timestamps —
   confirm you're comfortable public; if not, we use a private repo with
   Pages enabled which requires Pro).

## History

- 2026-09-20 — initial plan drafted from parent-provided DOM of
  LearnStage Excel High School Recent Activity feed; summary structure
  approved in conversation.
- 2026-09-20 — approved; open questions resolved: idle cap 30 min, 10 scroll bursts, 13:00 UTC, public repo with Actions secrets for credentials.

## History
### Implemented 2026-09-20 — first pass
- Implemented per Files to Modify; all plan Verification commands exit 0
  (parse.test.js, summarize.test.js, page.spec.js via npm test).
- RED evidence: parse/summarize tests failed pre-implementation with
  `Cannot find module '../parse.js'` / `'../summarize.js'` (absence of the
  AC'd behavior). AC5's page spec was authored after index.html existed —
  no red-first for the UI test; meaningfulness re-proven via break (assertion
  caught a real fixture-manifest/test-setup mismatch during first run: "both
  course names are rendered" failed against a single-course-day fixture,
  fixed the fixture, not the assertion).
- Rebalancing: none needed — unit layer for parse/summarize, page-level
  Playwright for index.html held against real implementation.
- Coverage gate: expanded with one concrete gap the implementation
  revealed — the page test's fixture manifest initially pointed at
  generated day files (nondeterministic in CI); fixtures made
  self-contained. No further high-value gap found beyond the AC set.
- Runtime validation: real-browser render of index.html at mobile
  viewport; console net CLEAN (no errors/warnings/pageerrors); evidence
  at .opencode/evidence/excel-daily-summary/ (day-card.png, full.png,
  ariaSnapshot.txt, console.txt).
- council-ux consult: invocation returned an empty result (agent defect);
  recorded as residual — no UX findings to fold; follow-up below.
- Mechanical deviation: AC2 fixture lacks the untyped-icon row the pasted
  DOM never contained as a distinct kind — parser fallback `other`
  covered via a forged fixture variant in parse.test.js (test-scoped
  sanitization, not a plan change).
- Deviations recorded: summarize.js contains an estimate note —
  cross-course gaps (student switching courses mid-gap) split the gap
  between courses (1 min floor) — a summarizer detail that emerged while
  mapping course minutes; consistent with the plan's estimation rule.

### Follow-ups
- council-ux replay (UX review of the rendered cards) — invocation returned empty; re-run at next pass.
- Raise scroll bursts beyond 10 if feed depth proves (default from Open Questions 2).
- Multi-child support via second data-id (Excluded, deliberate).

revised: [2026-09-20]
