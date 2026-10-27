// Summarizer v2: measured quiz durations + estimated reading range, merged
// into the committed per-day event store (data/events/).
"use strict";

const fs = require("fs");
const path = require("path");
const { eventKey, mergeEvents, groupByDay, loadStore, writeStore } = require("./store.js");

const SESSION_BREAK_MINUTES = 45;
const PAGE_CAP_LOW = 15;
const PAGE_CAP_HIGH = 30;
const SESSION_FLOOR_LOW_MINUTES = 5;
const SESSION_FLOOR_HIGH_MINUTES = 15;
const SESSION_BREAK_SECONDS = SESSION_BREAK_MINUTES * 60;
const SESSION_FLOOR_LOW_SECONDS = SESSION_FLOOR_LOW_MINUTES * 60;
const SESSION_FLOOR_HIGH_SECONDS = SESSION_FLOOR_HIGH_MINUTES * 60;

const fmtHM = (at) => (at ? String(at).slice(11, 16) : null);
const secondsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);
const roundMin = (seconds) => Math.round(seconds / 60);
const byAtId = (a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : String(a.id).localeCompare(String(b.id)));

function pairQuizzes(events) {
  const pending = new Map();
  const pairedGaps = new Set();
  const measuredByCourse = new Map();
  const pairs = [];
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
      measuredByCourse.set(e.course, (measuredByCourse.get(e.course) || 0) + seconds);
      pairs.push({ submitIndex: i, seconds });
      for (let gap = viewIndex + 1; gap <= i; gap++) pairedGaps.add(gap);
    }
  }
  return { measuredByCourse, pairedGaps, pairs };
}

function toDayJson({ date, events }) {
  const dayEvents = [...events].sort(byAtId);
  const { measuredByCourse, pairedGaps, pairs } = pairQuizzes(dayEvents);

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

  // Maximal runs split by an unpaired >= 45-minute gap; a paired quiz gap
  // never splits a session.
  const groups = [];
  let group = [];
  for (let i = 0; i < dayEvents.length; i++) {
    if (group.length === 0) { group.push(i); continue; }
    const gap = secondsBetween(dayEvents[group[group.length - 1]].at, dayEvents[i].at);
    if (!pairedGaps.has(i) && gap >= SESSION_BREAK_SECONDS) {
      groups.push(group);
      group = [i];
      continue;
    }
    group.push(i);
  }
  if (group.length) groups.push(group);

  const quizSecondsBySubmit = new Map(pairs.map((pair) => [pair.submitIndex, pair.seconds]));
  const sessions = [];
  let totalQuizSeconds = 0;
  let totalActiveLowSeconds = 0;
  let totalActiveHighSeconds = 0;
  for (const indices of groups) {
    let quizSeconds = 0;
    for (const index of indices) quizSeconds += quizSecondsBySubmit.get(index) || 0;

    let readingLowSeconds = 0;
    let readingHighSeconds = 0;
    for (let j = 1; j < indices.length; j++) {
      const index = indices[j];
      if (pairedGaps.has(index)) continue;
      const previous = dayEvents[indices[j - 1]];
      const event = dayEvents[index];
      const gap = secondsBetween(previous.at, event.at);
      if (gap >= SESSION_BREAK_SECONDS) continue;
      const low = Math.min(gap, PAGE_CAP_LOW * 60);
      const high = Math.min(gap, PAGE_CAP_HIGH * 60);
      readingLowSeconds += low;
      readingHighSeconds += high;
      if (event.course === previous.course) {
        const course = touch(event.course);
        course.readingLowSeconds += low;
        course.readingHighSeconds += high;
      } else {
        for (const name of new Set([event.course, previous.course])) {
          const course = touch(name);
          course.readingLowSeconds += Math.floor(low / 2);
          course.readingHighSeconds += Math.floor(high / 2);
        }
      }
    }

    const rawLow = quizSeconds + readingLowSeconds;
    const rawHigh = quizSeconds + readingHighSeconds;
    const activeLow = Math.max(rawLow, SESSION_FLOOR_LOW_SECONDS);
    const activeHigh = Math.max(rawHigh, SESSION_FLOOR_HIGH_SECONDS);
    const terminal = dayEvents[indices[indices.length - 1]];
    const residualLow = activeLow - rawLow;
    const residualHigh = activeHigh - rawHigh;
    if (residualLow || residualHigh) {
      const course = touch(terminal.course);
      course.readingLowSeconds += residualLow;
      course.readingHighSeconds += residualHigh;
    }

    const start = dayEvents[indices[0]].at;
    sessions.push({
      start: fmtHM(start),
      end: fmtHM(terminal.at),
      minutes: roundMin(secondsBetween(start, terminal.at)),
      minutes_low: roundMin(activeLow),
      minutes_high: roundMin(activeHigh),
    });

    totalQuizSeconds += quizSeconds;
    totalActiveLowSeconds += activeLow;
    totalActiveHighSeconds += activeHigh;
  }

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
    measured_quiz_minutes: roundMin(totalQuizSeconds),
    reading_minutes_low: roundMin(totalActiveLowSeconds - totalQuizSeconds),
    reading_minutes_high: roundMin(totalActiveHighSeconds - totalQuizSeconds),
    active_minutes_low: roundMin(totalActiveLowSeconds),
    active_minutes_high: roundMin(totalActiveHighSeconds),
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

function writeStatus(outDir, raw) {
  const status = { fetched_at: (raw && raw.fetched_at) || new Date().toISOString() };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "status.json"), JSON.stringify(status) + "\n");
  return status;
}

function writeManifest(outDir, storeDir, days) {
  const manifest = days.map((day) => `data/${day.date}.json`);
  const stored = fs.existsSync(storeDir) ? fs.readdirSync(storeDir) : [];
  for (const file of stored) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    const ref = `data/${file}`;
    if (!manifest.includes(ref)) manifest.push(ref);
  }
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(manifest.sort().reverse(), null, 2) + "\n");
}

function rebuild(storeDir, outDir) {
  const byDay = groupByDay(loadStore(storeDir));
  const days = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const [date, dayEvents] of [...byDay.entries()].sort()) {
    const day = toDayJson({ date, events: dayEvents });
    days.push(day);
    fs.writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify(day, null, 2) + "\n");
  }
  writeManifest(outDir, storeDir, days);
  return days;
}

module.exports = {
  SESSION_BREAK_MINUTES, PAGE_CAP_LOW, PAGE_CAP_HIGH, SESSION_FLOOR_LOW_MINUTES,
  SESSION_FLOOR_HIGH_MINUTES, toDayJson, summarize, writeStatus, rebuild,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const storeDir = path.join(process.cwd(), "data", "events");
  const outDir = path.join(process.cwd(), "data");
  if (args.includes("--rebuild")) {
    const days = rebuild(storeDir, outDir);
    console.log("summarize rebuilt", days.map((day) => `data/${day.date}.json`).join(", ") || "no days");
    process.exit(0);
  }
  const [src] = args;
  if (!src) { console.error("usage: node summarize.js <raw-events.json> | --rebuild"); process.exit(2); }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(src, "utf8")); }
  catch (e) { console.error("cannot read raw events:", e.message); process.exit(1); }
  const events = raw.events || [];
  if (events.length === 0) { console.error("no events in", src); process.exit(1); }

  const result = summarize(events, { stored: loadStore(storeDir) });
  writeStatus(outDir, raw);
  if (!result.wrote) {
    console.log("no changes");
    process.exit(0);
  }
  writeStore(storeDir, result.merged);
  const changed = new Set(result.changedDays);
  for (const day of result.days) {
    if (!changed.has(day.date)) continue;
    fs.writeFileSync(path.join(outDir, `${day.date}.json`), JSON.stringify(day, null, 2) + "\n");
  }
  writeManifest(outDir, storeDir, result.days);
  console.log("summarize wrote", result.changedDays.map((d) => `data/${d}.json`).join(", "));
}
