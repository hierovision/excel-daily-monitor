// AC3 — idle cap / session split; AC4 — per-day file shape + dedupe.
const { summarize, toDayJson } = require("../summarize.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const ev = (item, kind, at, course) => ({ item, kind, at, course });

// AC3: 29-min gap counts, 31-min gap splits sessions and contributes 0
const nearGap = { date: "2026-09-17", course: "Media Arts EHS",
  events: [ev("Page 1", "page_viewed", "2026-09-17T14:00:00", "Media Arts EHS"),
           ev("Page 2", "page_viewed", "2026-09-17T14:29:00", "Media Arts EHS")] };
const dayNear = toDayJson(nearGap);
assert(dayNear.estimated_active_minutes === 29, `29-min gap counts (got ${dayNear.estimated_active_minutes})`);

const overGap = { date: "2026-09-17", course: "Media Arts EHS",
  events: [ev("Page 1", "page_viewed", "2026-09-17T14:00:00", "Media Arts EHS"),
           ev("Page 2", "page_viewed", "2026-09-17T15:01:00", "Media Arts EHS")] };
const dayOver = toDayJson(overGap);
assert(dayOver.sessions.length === 2, `31-min gap splits into 2 sessions (got ${dayOver.sessions.length})`);
assert(dayOver.estimated_active_minutes === 0, `idle gap contributes 0 active minutes (got ${dayOver.estimated_active_minutes})`);
assert(dayOver.span_minutes === 61, `span is last-first unfiltered (got ${dayOver.span_minutes})`);

// AC3: single-course day -> one by_course entry
assert(dayNear.by_course.length === 1
  && dayNear.by_course[0].course === "Media Arts EHS", "one course -> one by_course entry");

// AC3: multiple logins -> >=2 sessions (3 events, two >30-min gaps)
const multi = { date: "2026-09-17", course: "Media Arts EHS",
  events: [ev("A", "page_viewed", "2026-09-17T08:00:00", "Media Arts EHS"),
           ev("B", "page_viewed", "2026-09-17T08:10:00", "Media Arts EHS"),
           ev("C", "page_viewed", "2026-09-17T12:00:00", "Media Arts EHS"),
           ev("D", "page_viewed", "2026-09-17T20:00:00", "Media Arts EHS")] };
assert(toDayJson(multi).sessions.length === 3, `multiple logins produce >=2 sessions (got ${toDayJson(multi).sessions.length})`);

// AC4: schema shape
const full = toDayJson({ date: "2026-09-17", course: "Media Arts EHS", events: nearGap.events });
for (const key of ["date","first_activity_at","last_activity_at","span_minutes","estimated_active_minutes",
  "sessions","by_course","event_counts","submissions_and_grades"]) {
  assert(key in full, `day JSON has key ${key}`);
}
assert(full.submissions_and_grades.length === 0, "no submissions -> empty list");
const withQuiz = toDayJson({ date: "2026-09-17", course: "Media Arts EHS",
  events: [ev("Module 1 Quiz", "quiz_submitted", "2026-09-17T21:21:19", "Media Arts EHS")] });
assert(withQuiz.submissions_and_grades.length === 1
  && withQuiz.submissions_and_grades[0].item === "Module 1 Quiz", "quiz submission lands in submissions_and_grades");

// AC4: dedupe on item+kind+timestamp
const { dedupeEvents } = require("../summarize.js");
const dupes = [ev("Module 1 Quiz", "quiz_submitted", "2026-09-17T21:21:19", "Media Arts EHS"),
               ev("Module 1 Quiz", "quiz_submitted", "2026-09-17T21:21:19", "Media Arts EHS")];
assert(dedupeEvents(dupes).length === 1, "duplicate events (item+kind+at) collapse to one");

// AC6: summarize refuses empty input without writing
assert(!summarize([]).wrote, "summarize on empty events marks not-wrote / non-zero path");

console.log(failures ? "summarize.test.js FAILED" : "summarize.test.js ok");
process.exit(failures ? 1 : 0);
