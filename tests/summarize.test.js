// R3-R5 — measured quiz time, reading range, store merge, v2 schema.
const { toDayJson, summarize, SESSION_BREAK_MINUTES } = require("../summarize.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const ev = (id, at, kind, item = "Page", course = "Media Arts EHS", context_id = "c1") =>
  ({ id, at_utc: `${at}.000Z`, at, kind, item, course, context_id });
const etIso = (baseUtc, plusSeconds) =>
  new Date(Date.parse(baseUtc) + plusSeconds * 1000).toISOString().replace(".000Z", "");

assert(SESSION_BREAK_MINUTES === 45, "session break constant is 45");

// R3: a 39-min quiz pair is measured in full, not capped.
const quizDay = toDayJson({ date: "2026-09-17", events: [
  ev("v1", "2026-09-17T21:00:00", "quiz_viewed", "Module 1 Quiz"),
  ev("s1", "2026-09-17T21:39:00", "quiz_submitted", "Module 1 Quiz"),
]});
assert(quizDay.measured_quiz_minutes === 39, `39-min pair measured fully (got ${quizDay.measured_quiz_minutes})`);
assert(quizDay.reading_minutes_low === 0 && quizDay.reading_minutes_high === 0,
  "pair interval is not double-counted as reading");
assert(quizDay.active_minutes_low === 39 && quizDay.active_minutes_high === 39,
  "active = measured quiz when there is no reading");

// R4: page gap of 29 min -> low capped at 15, high capped at 30.
const near = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:29:00", "page_viewed"),
]});
assert(near.reading_minutes_low === 15, `29-min gap low cap 15 (got ${near.reading_minutes_low})`);
assert(near.reading_minutes_high === 29, `29-min gap high counts 29 (got ${near.reading_minutes_high})`);
assert(near.active_minutes_low === 15 && near.active_minutes_high === 29, "active follows reading");

// R4: a >=45-min gap splits sessions and contributes nothing.
const over = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:46:00", "page_viewed"),
]});
assert(over.sessions.length === 2, `46-min gap splits sessions (got ${over.sessions.length})`);
assert(over.reading_minutes_low === 0 && over.reading_minutes_high === 0, "idle gap contributes 0");

// R4: rapid events keep their span (seconds summed, rounded once).
const rapid = [];
for (let i = 0; i < 47; i++) {
  rapid.push(ev(`r${i}`, etIso("2026-09-17T16:00:00.000Z", i * 20), "page_viewed"));
}
const rapidDay = toDayJson({ date: "2026-09-17", events: rapid });
assert(rapidDay.active_minutes_high >= 15 && rapidDay.active_minutes_high <= 16,
  `47 rapid events preserve the ~15-min span (got ${rapidDay.active_minutes_high})`);
assert(rapidDay.active_minutes_low === rapidDay.active_minutes_high, "sub-minute gaps are not capped apart");

// R3+R4 combined: measured quiz + estimated reading.
const combo = toDayJson({ date: "2026-09-17", events: [
  ev("p", "2026-09-17T20:00:00", "page_viewed", "Section 1.9"),
  ev("v", "2026-09-17T20:20:00", "quiz_viewed", "Module 1 Quiz"),
  ev("s", "2026-09-17T20:59:00", "quiz_submitted", "Module 1 Quiz"),
]});
assert(combo.measured_quiz_minutes === 39, `combo quiz 39 (got ${combo.measured_quiz_minutes})`);
assert(combo.reading_minutes_low === 15 && combo.reading_minutes_high === 20,
  `combo reading 15/20 (got ${combo.reading_minutes_low}/${combo.reading_minutes_high})`);
assert(combo.active_minutes_low === 54 && combo.active_minutes_high === 59,
  `active = quiz + reading (got ${combo.active_minutes_low}/${combo.active_minutes_high})`);

// R5: v2 day schema + per-course fields.
const day = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:29:00", "page_viewed"),
  ev("v1", "2026-09-17T21:00:00", "quiz_viewed", "Module 1 Quiz", "World History EHS"),
  ev("s1", "2026-09-17T21:39:00", "quiz_submitted", "Module 1 Quiz", "World History EHS"),
]});
for (const key of ["date", "first_activity_at", "last_activity_at", "span_minutes",
  "measured_quiz_minutes", "reading_minutes_low", "reading_minutes_high",
  "active_minutes_low", "active_minutes_high", "sessions", "by_course",
  "event_counts", "submissions_and_grades"]) {
  assert(key in day, `day JSON has key ${key}`);
}
assert(day.by_course.length === 2, `two courses -> two by_course entries (got ${day.by_course.length})`);
for (const c of day.by_course) {
  for (const key of ["course", "measured_quiz_minutes", "reading_minutes_low",
    "reading_minutes_high", "active_minutes_low", "active_minutes_high"]) {
    assert(key in c, `by_course has key ${key}`);
  }
}
assert(day.submissions_and_grades.length === 1
  && day.submissions_and_grades[0].item === "Module 1 Quiz", "quiz submission recorded");

// R5/R6: summarize merges into the store, is idempotent, and reports changed days.
const dayEvents = [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:29:00", "page_viewed"),
];
const fresh = summarize(dayEvents, { stored: [] });
assert(fresh.wrote && fresh.changedDays.join(",") === "2026-09-17", "fresh summarize writes the day");
const again = summarize(dayEvents, { stored: dayEvents });
assert(again.wrote === false && again.changedDays.length === 0, "re-summarizing stored events is a no-op");
const overlap = summarize([...dayEvents, ev("c", "2026-09-17T14:40:00", "page_viewed")], { stored: dayEvents });
assert(overlap.changedDays.join(",") === "2026-09-17", "new event marks the day changed");
assert(overlap.days[0].reading_minutes_low >= near.reading_minutes_low, "day recomputed from merged events");

// R10: empty input does not write.
assert(summarize([]).wrote === false, "summarize on empty events marks not-wrote");

// Coverage-gate expansion (real-implementation branches):
// an intervening event inside a measured quiz pair must not double-count reading.
const interleaved = toDayJson({ date: "2026-09-17", events: [
  ev("v", "2026-09-17T21:00:00", "quiz_viewed", "Module 1 Quiz"),
  ev("p", "2026-09-17T21:10:00", "page_viewed", "Section 1.9"),
  ev("s", "2026-09-17T21:39:00", "quiz_submitted", "Module 1 Quiz"),
]});
assert(interleaved.measured_quiz_minutes === 39,
  `interleaved pair still measures 39 (got ${interleaved.measured_quiz_minutes})`);
assert(interleaved.reading_minutes_high === 0,
  `no reading counted inside the measured pair (got ${interleaved.reading_minutes_high})`);

// cross-course gaps split evenly (floor) between both courses.
const cross = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed", "P", "Media Arts EHS"),
  ev("b", "2026-09-17T14:10:00", "page_viewed", "P", "World History EHS"),
]});
const ma = cross.by_course.find((c) => c.course === "Media Arts EHS");
const wh = cross.by_course.find((c) => c.course === "World History EHS");
assert(ma.reading_minutes_low === 5 && wh.reading_minutes_low === 5,
  `cross-course 10-min gap splits 5/5 (got ${ma.reading_minutes_low}/${wh.reading_minutes_low})`);

console.log(failures ? "summarize.test.js FAILED" : "summarize.test.js ok");
process.exit(failures ? 1 : 0);
