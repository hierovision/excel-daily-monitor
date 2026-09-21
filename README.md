# excel-daily-monitor

Daily summary of your child's Excel High School (LearnStage) activity,
delivered as a phone-friendly GitHub Pages page that keeps the current day
up to date on its own.

**At a glance:** the page opens with a pinned **Today** section for the
literal calendar date in `America/New_York`, expanded by default; below it a
week band totals the **calendar week (Monday–Sunday)** containing the anchor
date, and each day is one collapsed line (`about 1h 07m active`, `no activity`,
or `—` for a day that has not happened yet) that expands to the shared compact
detail. A single footer stamps the data's `Data as of` date and time.
Prev/Next step one calendar week; the date picker maps the picked date to its
containing week. `Today` stays pinned.

**Calendar week:** the default view is the current ET week, Monday start,
rendered ascending (Mon→Sun). The band heading reads `This week` only there;
browsing back shows `Week of <Mon D>`. Elapsed days with no capture stay
`no activity`; days after today render a muted `—` (they have not happened).
`Next` is disabled at the current week (no future browsing) and `Prev` at the
earliest week with a day file; the picker's `max` is today.

**Compact detail** (the same markup in `Today` and every expanded day):

- `Active` shows the estimated range (`1h 00m–1h 14m`), `Quizzes (measured)`
  the measured quiz time, and `Reading` its estimated range. A range renders
  only when the low and high estimates differ; otherwise one value.
- `Courses` lists each course with the **low** estimate only — the same page
  gaps are apportioned across courses, so per-course ranges would imply
  precision that does not exist.
- `Sessions (N) · first–last` expands to the session segments.
- Submissions render course-first with the time (`Course — Item · HH:MM`),
  inline up to three, then collapsed under `Submissions (N)`.
- A one-line legend under the week band defines the estimate basis:
  `Unmarked durations are estimated from page-open gaps; quizzes are measured.`
- Days captured with the legacy v1 summarizer show only a single `Active`
  value, their per-course `estimated_minutes`, and the muted note
  `estimated from session span` (their basis differs from page gaps).

How the numbers are built:

- **Quizzes (measured)** — the platform logs quiz view/submit events, so the
  gap between them is real quiz time.
- **Reading/work (estimated)** — the platform logs page opens, not time on
  page, so gaps between events are capped (15–30 min) and shown as a range.
  Gaps of 45+ minutes split sessions and count as idle.
- `active = measured quiz time + estimated reading range`.

## Keeping the current day fresh

- The workflow captures the account **every 30 minutes from 12:00–23:30 UTC,
  all seven days** (08:00–19:30 EDT / 07:00–18:30 EST; the cron is UTC-only,
  so DST shifts the local edges by an hour), alongside the nightly 07:00 UTC
  run. GitHub's own schedule delay adds natural jitter. Every successful run
  rewrites `data/status.json` (the last API query time), so the workflow
  commits a small status file per intraday run even when no events changed.
- While the page is open and visible it polls every 2 minutes: it re-fetches
  `data/index.json` (so a day file that appears mid-session is picked up),
  today's day file, and `data/status.json`, all with `cache: "no-store"`, then
  re-renders in place. Open day cards and session disclosures survive the
  re-render.
- The status line shows the **last pipeline retrieval time**, when the
  scheduled run last queried the LMS API — `Data retrieved <Mon D, h:mm AM/PM
  ET>`, read from `data/status.json`'s `fetched_at`. It is never the page
  refresh time (the page clock is not displayed). The `Refresh` button
  re-fetches it immediately (`Checking…` while in flight); a failed day fetch
  shows `Showing last loaded data` — the last good detail stays on screen and
  the page recovers on the next successful poll — and a missing or invalid
  status file shows `Retrieval time unavailable`. The footer's
  `Data as of <date> <time>` remains an activity timestamp, not a retrieval
  time.
- Polling pauses while the tab is hidden and refreshes immediately when it
  becomes visible again.
- **Freshness bound:** new data appears within one capture interval (~30 min)
  plus the Pages deploy propagation time, and within one poll (~2 min) of the
  deployed file changing.

## One-time setup

1. Push this repo to GitHub (public).
2. Settings → Secrets and variables → Actions → add `EXCEL_USERNAME` and
   `EXCEL_PASSWORD` (the parent portal login).
3. Settings → Pages → Source: **GitHub Actions**.
4. Actions tab → "daily-summary" → Run workflow → observe a green run.
5. Visiting the published URL gets you the summary.

Activity events live in the committed store under `data/events/YYYY-MM-DD.json`,
deduped by the platform's event id; each run fetches only what is newer than
the newest stored event, so repeat runs are cheap. Every successful run also
rewrites `data/status.json` with its `fetched_at`, so the workflow commits a
small status file each intraday run even when no events changed. Day summaries
(`data/YYYY-MM-DD.json`) are derived from the store and rendered as the 7-day
window plus history.

Requests are paced like a person browsing (serial calls, 450–800 ms jitter,
occasional reading pauses, backoff on 429/503, page fetches only until stored
history begins) — never bot-like bursts.

## Manual refresh (parent only)

The page never triggers the workflow — it only ever talks to its own origin.
To force a capture out of band, use the authenticated path: `gh workflow run
daily-summary` or the Actions tab → "daily-summary" → **Run workflow**.

## Manual local run (with credentials)

```
EXCEL_USERNAME=... EXCEL_PASSWORD=... node scrape.js
node summarize.js data/raw-events.json
npm test
```

## When a run fails

The run page carries a downloadable **scrape-failure** artifact
(`failure.json`, `page-*.png`, `page-*.html`, `console.log`, `network.log`)
capturing the page state at the failure point. Auth tokens are redacted before
writing; the full Playwright trace stays on the runner because traces embed
URLs and network bodies. The page keeps showing the last successful data with
its "data as of" line.
