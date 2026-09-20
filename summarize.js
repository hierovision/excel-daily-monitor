// Summarizer: events[] -> per-day JSON (schema per plan AC4).
// Time-on-activity is estimated from gaps between consecutive events.
// Gaps > IDLE_MINUTES split sessions and contribute 0 active minutes.
"use strict";

const IDLE_MINUTES = 30;

function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const key = `${e.item}|${e.kind}|${e.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

const fmtHM = (at) => (at ? String(at).slice(11, 16) : null);

function splitSessions(dayEvents) {
  const sessions = [];
  let start = null, prev = null, minutes = 0;
  for (const e of dayEvents) {
    if (prev === null) { start = e.at; minutes = 0; prev = e.at; continue; }
    const gapMin = Math.round((Date.parse(e.at) - Date.parse(prev)) / 60000);
    if (gapMin > IDLE_MINUTES) {
      sessions.push({ start: fmtHM(start), end: fmtHM(prev), minutes });
      start = e.at; minutes = 0;
    } else {
      minutes += gapMin;
    }
    prev = e.at;
  }
  if (start) sessions.push({ start: fmtHM(start), end: fmtHM(prev), minutes });
  return sessions;
}

function computeActive(dayEvents) {
  let active = 0;
  for (let i = 1; i < dayEvents.length; i++) {
    const gapMin = Math.round((Date.parse(dayEvents[i].at) - Date.parse(dayEvents[i - 1].at)) / 60000);
    active += gapMin < IDLE_MINUTES ? gapMin : 0;
  }
  return active;
}

function toDayJson({ date, course, events }) {
  if (!date) throw new Error("date required");
  const dayEvents = [...events].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const byCourse = new Map();
  const eventCounts = {};
  const submissions = [];
  for (const e of dayEvents) {
    const c = byCourse.get(e.course) || { course: e.course, estimated_minutes: 0, pages_viewed: 0, quiz_submissions: [] };
    if (e.kind === "page_viewed") c.pages_viewed++;
    if (e.kind === "quiz_submitted") {
      c.quiz_submissions.push({ item: e.item, at: String(e.at).slice(11) });
      submissions.push({ kind: "quiz_submitted", item: e.item, course: e.course, at: String(e.at).slice(11) });
    }
    byCourse.set(e.course, c);
  }
  // Per-course active minutes: only gaps where the next event is the same course
  // count toward that course (cross-course gaps split evenly, 1 min floor per idled course).
  for (let i = 1; i < dayEvents.length; i++) {
    const gapMin = Math.round((Date.parse(dayEvents[i].at) - Date.parse(dayEvents[i - 1].at)) / 60000);
    if (gapMin >= IDLE_MINUTES) continue;
    if (dayEvents[i].course === dayEvents[i - 1].course) {
      byCourse.get(dayEvents[i].course).estimated_minutes += gapMin;
    } else {
      for (const courseName of new Set([dayEvents[i].course, dayEvents[i - 1].course])) {
        byCourse.get(courseName).estimated_minutes += Math.max(1, Math.floor(gapMin / 2));
      }
    }
  }

  const first = dayEvents[0] ? dayEvents[0].at : null;
  const last = dayEvents.length ? dayEvents[dayEvents.length - 1].at : null;
  return {
    date,
    first_activity_at: first ? String(first).slice(11) : null,
    last_activity_at: last ? String(last).slice(11) : null,
    span_minutes: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 60000) : 0,
    estimated_active_minutes: computeActive(dayEvents),
    sessions: splitSessions(dayEvents),
    by_course: [...byCourse.values()],
    event_counts: eventCounts,
    submissions_and_grades: submissions.sort((a, b) => b.at.localeCompare(a.at)),
  };
}

function summarize(events, { prior = [] } = {}) {
  const merged = dedupeEvents([...events, ...prior]);
  if (merged.length === 0) return { wrote: false, files: [] };

  // A feed snapshot may span multiple calendar days -> group by day.
  const byDay = new Map();
  for (const e of merged) {
    const d = String(e.at).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }
  const files = [];
  const days = [];
  for (const [date, evs] of byDay) {
    days.push(toDayJson({ date, events: evs }));
    files.push(`data/${date}.json`);
  }
  return { wrote: true, files, days };
}

module.exports = { IDLE_MINUTES, dedupeEvents, summarize, toDayJson };

if (require.main === module) {
  // CLI: node summarize.js <raw-events.json>  — writes data/YYYY-MM-DD.json + data/index.json
  const [src] = process.argv.slice(2);
  if (!src) { console.error("usage: node summarize.js <raw-events.json>"); process.exit(2); }
  let raw;
  try { raw = JSON.parse(require("fs").readFileSync(src, "utf8")); }
  catch (e) { console.error("cannot read raw events:", e.message); process.exit(1); }
  const events = raw.events || [];
  if (events.length === 0) { console.error("no events in", src); process.exit(1); }
  const fs = require("fs");
  fs.mkdirSync("data", { recursive: true });
  const result = summarize(events);
  if (!result.wrote) { console.error("nothing summarized"); process.exit(1); }
  const manifest = [];
  for (const day of result.days) {
    const file = `data/${day.date}.json`;
    fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n");
    manifest.push(file);
  }
  fs.writeFileSync("data/index.json", JSON.stringify(manifest.sort().reverse(), null, 2) + "\n");
  console.log("summarize wrote", manifest.join(", "));
}
