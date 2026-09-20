# excel-daily-monitor

Nightly summary of your child's Excel High School (LearnStage) activity,
delivered as a phone-friendly GitHub Pages page.

**You will see, for each day:** estimated active minutes per course, the
session timeline, event counts, and quiz submissions. Times are estimates
derived from the gap between consecutive "Recent Activity" events; a gap
over 30 minutes is treated as idle (session splitting), not study time.

## One-time setup

1. Push this repo to GitHub (public).
2. Settings → Secrets and variables → Actions → add `EXCEL_USERNAME` and
   `EXCEL_PASSWORD` (the parent portal login).
3. Settings → Pages → Source: **GitHub Actions**.
4. Actions tab → "daily-summary" → Run workflow → observe a green run.
5. Visiting the published URL gets you the summary.

Workflow: nightly at 13:00 UTC (~6–7am Central). Past days accumulate in
`data/YYYY-MM-DD.json` and render as a history scroll on the page.

## Manual local run (with credentials)

```
EXCEL_USERNAME=... EXCEL_PASSWORD=... node scrape.js
node summarize.js data/raw-events.json
npm test
```

## When a nightly run fails

The run page carries a downloadable **scrape-failure** artifact
(`failure.json`, `page-*.png`, `page-*.html`, `console.log`, `network.log`) capturing the
page state at the failure point. Auth tokens are redacted before writing;
the full Playwright trace stays on the runner because traces embed URLs
and network bodies. The page keeps showing the
last successful day with its "data as of" line.
