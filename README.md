# excel-daily-monitor

Nightly summary of your child's Excel High School (LearnStage) activity,
delivered as a phone-friendly GitHub Pages page.

**At a glance:** a week band above the day list shows how many days had
activity, the estimated active total (an `about` midpoint plus its range),
and quiz submissions; each day is one collapsed line (`about 1h 07m active`,
or `no activity`) that expands to the full detail — measured quiz time,
estimated reading range, per-course lines, session times, first-to-last
activity, and submissions. A single footer stamps the data's `Data as of`
date and time. The page opens on a rolling 7-day window with Prev/Next week
buttons and a date picker.

How the numbers are built:

- **Quizzes (measured)** — the platform logs quiz view/submit events, so the
  gap between them is real quiz time.
- **Reading/work (estimated)** — the platform logs page opens, not time on
  page, so gaps between events are capped (15–30 min) and shown as a range.
  Gaps of 45+ minutes split sessions and count as idle.
- `active = measured quiz time + estimated reading range`.

## One-time setup

1. Push this repo to GitHub (public).
2. Settings → Secrets and variables → Actions → add `EXCEL_USERNAME` and
   `EXCEL_PASSWORD` (the parent portal login).
3. Settings → Pages → Source: **GitHub Actions**.
4. Actions tab → "daily-summary" → Run workflow → observe a green run.
5. Visiting the published URL gets you the summary.

The workflow runs nightly at 07:00 UTC (~3am Eastern), so the summary is ready
before the morning. Activity events live in the committed store under
`data/events/YYYY-MM-DD.json`, deduped by the platform's event id; each run
fetches only what is newer than the newest stored event, so repeat runs are
cheap and commits only happen when something changed. Day summaries
(`data/YYYY-MM-DD.json`) are derived from the store and rendered as the
7-day window plus history.

Requests are paced like a person browsing (serial calls, 450–800 ms jitter,
occasional reading pauses, backoff on 429/503, page fetches only until stored
history begins) — never bot-like bursts.

## Manual local run (with credentials)

```
EXCEL_USERNAME=... EXCEL_PASSWORD=... node scrape.js
node summarize.js data/raw-events.json
npm test
```

## When a nightly run fails

The run page carries a downloadable **scrape-failure** artifact
(`failure.json`, `page-*.png`, `page-*.html`, `console.log`, `network.log`)
capturing the page state at the failure point. Auth tokens are redacted before
writing; the full Playwright trace stays on the runner because traces embed
URLs and network bodies. The page keeps showing the last successful data with
its "data as of" line.
