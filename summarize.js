// Summarizer v2: measured quiz durations + estimated reading range, merged
// into the committed per-day event store (data/events/).
"use strict";

const fs = require("fs");
const path = require("path");
const { eventKey, mergeEvents, groupByDay, loadStore, writeStore } = require("./store.js");

const SESSION_BREAK_MINUTES = 45;
const PAGE_CAP_LOW = 15;
const PAGE_CAP_HIGH = 30;
const SESSION_BREAK_SECONDS = SESSION_BREAK_MINUTES * 60;

const fmtHM = (at) => (at ? String(at).slice(11, 16) : null);
const secondsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);
const roundMin = (seconds) => Math.round(seconds / 60);
const byAtId = (a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : String(a.id).localeCompare(String(b.id)));

function pairQuizzes(events) {
  const pending = new Map();
  const pairedGaps = new Set();
  const measuredByCourse = new Map();
  let measuredSeconds = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "quiz_viewed") {
      if (!pending.has(e.context_id)) pending.set(e.context_id, []);
      pending.get(e.context_id).push(i);
    } else if (e.kind === "quiz_submitted") {
      const views = pending.get(e.context_id) || [];
      const viewIndex = views.pop();
      if (viewIndex === undefined) continue;
      const seconds = secondsBetween(events[viewIndex].at, e.at);
      measuredSeconds += seconds;
      measuredByCourse.set(e.course, (measuredByCourse.get(e.course) || 0) + seconds);
      for (let gap = viewIndex + 1; gap <= i; gap++) pairedGaps.add(gap);
    }
  }
  return { measuredSeconds, measuredByCourse, pairedGaps };
}

function toDayJson({ date, events }) {
  const dayEvents = [...events].sort(byAtId);
  const { measuredSeconds, measuredByCourse, pairedGaps } = pairQuizzes(dayEvents);

  const courses = new Map();
  const touch = (course) => {
    if (!courses.has(course)) {
      courses.set(course, { course, readingLowSeconds: 0, readingHighSeconds: 0, quizSeconds: 0, pages_viewed: 0, quiz_submissions: [] });
    }
    return courses.get(course);
  };
  const eventCounts = { page_viewed: 0, quiz_viewed: 0, quiz_submitted: 0, other: 0 };
  const submissions = [];
  for (const e of dayEvents) {
    eventCounts[e.kind] = (eventCounts[e.kind] || 0) + 1;
    const course = touch(e.course);
    if (e.kind === "page_viewed") course.pages_viewed++;
    if (e.kind === "quiz_submitted") {
      course.quiz_submissions.push({ item: e.item, at: fmtHM(e.at) });
      submissions.push({ kind: "quiz_submitted", item: e.item, course: e.course, at: fmtHM(e.at) });
    }
  }
  for (const [course, seconds] of measuredByCourse) touch(course).quizSeconds = seconds;

  let readingLowSeconds = 0;
  let readingHighSeconds = 0;
  for (let i = 1; i < dayEvents.length; i++) {
    if (pairedGaps.has(i)) continue;
    const gap = secondsBetween(dayEvents[i - 1].at, dayEvents[i].at);
    if (gap >= SESSION_BREAK_SECONDS) continue;
    const low = Math.min(gap, PAGE_CAP_LOW * 60);
    const high = Math.min(gap, PAGE_CAP_HIGH * 60);
    readingLowSeconds += low;
    readingHighSeconds += high;
    if (dayEvents[i].course === dayEvents[i - 1].course) {
      const course = touch(dayEvents[i].course);
      course.readingLowSeconds += low;
      course.readingHighSeconds += high;
    } else {
      for (const name of new Set([dayEvents[i].course, dayEvents[i - 1].course])) {
        const course = touch(name);
        course.readingLowSeconds += Math.floor(low / 2);
        course.readingHighSeconds += Math.floor(high / 2);
      }
    }
  }

  const sessions = [];
  let start = null;
  let previous = null;
  let sessionSeconds = 0;
  const flush = () => {
    if (start !== null) sessions.push({ start: fmtHM(start), end: fmtHM(previous), minutes: roundMin(sessionSeconds) });
    sessionSeconds = 0;
  };
  for (let i = 0; i < dayEvents.length; i++) {
    const e = dayEvents[i];
    if (start === null) { start = e.at; previous = e.at; continue; }
    const gap = secondsBetween(previous, e.at);
    if (!pairedGaps.has(i) && gap >= SESSION_BREAK_SECONDS) {
      flush();
      start = e.at;
      previous = e.at;
      continue;
    }
    sessionSeconds += gap;
    previous = e.at;
  }
  flush();

  const byCourse = [...courses.values()].map((c) => ({
    course: c.course,
    measured_quiz_minutes: roundMin(c.quizSeconds),
    reading_minutes_low: roundMin(c.readingLowSeconds),
    reading_minutes_high: roundMin(c.readingHighSeconds),
    active_minutes_low: roundMin(c.quizSeconds + c.readingLowSeconds),
    active_minutes_high: roundMin(c.quizSeconds + c.readingHighSeconds),
    pages_viewed: c.pages_viewed,
    quiz_submissions: c.quiz_submissions,
  }));

  const first = dayEvents[0] ? dayEvents[0].at : null;
  const last = dayEvents.length ? dayEvents[dayEvents.length - 1].at : null;
  return {
    date,
    first_activity_at: first ? String(first).slice(11) : null,
    last_activity_at: last ? String(last).slice(11) : null,
    span_minutes: first && last ? roundMin(secondsBetween(first, last)) : 0,
    measured_quiz_minutes: roundMin(measuredSeconds),
    reading_minutes_low: roundMin(readingLowSeconds),
    reading_minutes_high: roundMin(readingHighSeconds),
    active_minutes_low: roundMin(measuredSeconds + readingLowSeconds),
    active_minutes_high: roundMin(measuredSeconds + readingHighSeconds),
    sessions,
    by_course: byCourse,
    event_counts: eventCounts,
    submissions_and_grades: submissions.sort((a, b) => b.at.localeCompare(a.at)),
  };
}

function summarize(fetched, { stored = [] } = {}) {
  if (!Array.isArray(fetched) || fetched.length === 0) {
    return { wrote: false, changedDays: [], days: [], merged: [...(stored || [])] };
  }
  const merged = mergeEvents(stored, fetched);
  const byDay = groupByDay(merged);
  const storedByDay = groupByDay(stored);
  const changedDays = [];
  const days = [];
  for (const [date, dayEvents] of [...byDay.entries()].sort()) {
    const before = (storedByDay.get(date) || []).map(eventKey).sort().join(",");
    const after = dayEvents.map(eventKey).sort().join(",");
    if (before !== after) changedDays.push(date);
    days.push(toDayJson({ date, events: dayEvents }));
  }
  return { wrote: changedDays.length > 0, changedDays, days, merged };
}

module.exports = { SESSION_BREAK_MINUTES, PAGE_CAP_LOW, PAGE_CAP_HIGH, toDayJson, summarize };

if (require.main === module) {
  const [src] = process.argv.slice(2);
  if (!src) { console.error("usage: node summarize.js <raw-events.json>"); process.exit(2); }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(src, "utf8")); }
  catch (e) { console.error("cannot read raw events:", e.message); process.exit(1); }
  const events = raw.events || [];
  if (events.length === 0) { console.error("no events in", src); process.exit(1); }

  const storeDir = path.join(process.cwd(), "data", "events");
  const outDir = path.join(process.cwd(), "data");
  const result = summarize(events, { stored: loadStore(storeDir) });
  if (!result.wrote) {
    console.log("no changes");
    process.exit(0);
  }
  writeStore(storeDir, result.merged);
  const changed = new Set(result.changedDays);
  const manifest = [];
  for (const day of result.days) {
    const file = path.join(outDir, `${day.date}.json`);
    manifest.push(`data/${day.date}.json`);
    if (changed.has(day.date)) fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n");
  }
  for (const file of fs.readdirSync(storeDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    const ref = `data/${file}`;
    if (!manifest.includes(ref)) manifest.push(ref);
  }
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(manifest.sort().reverse(), null, 2) + "\n");
  console.log("summarize wrote", result.changedDays.map((d) => `data/${d}.json`).join(", "));
}
