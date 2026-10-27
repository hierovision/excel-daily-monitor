// R3-R5 — measured quiz time, reading range, store merge, v2 schema.
// AC18 — writeStatus writes data/status.json from the scrape's fetched_at.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  toDayJson, summarize, SESSION_BREAK_MINUTES, SESSION_FLOOR_LOW_MINUTES,
  SESSION_FLOOR_HIGH_MINUTES, writeStatus,
} = require("../summarize.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const ev = (id, at, kind, item = "Page", course = "Media Arts EHS", context_id = "c1") =>
  ({ id, at_utc: `${at}.000Z`, at, kind, item, course, context_id });
const etIso = (baseUtc, plusSeconds) =>
  new Date(Date.parse(baseUtc) + plusSeconds * 1000).toISOString().replace(".000Z", "");

assert(SESSION_BREAK_MINUTES === 45, "session break constant is 45");
assert(SESSION_FLOOR_LOW_MINUTES === 5 && SESSION_FLOOR_HIGH_MINUTES === 15,
  "session floor constants are 5/15");

// Session floor (AC1): a lone event still contributes a bounded 5–15 min,
// while the session keeps its raw zero-minute span.
const lone = toDayJson({ date: "2026-10-26", events: [
  ev("p1", "2026-10-26T11:04:19", "page_viewed"),
]});
assert(lone.active_minutes_low === 5 && lone.active_minutes_high === 15,
  `one-event session active is 5/15 (got ${lone.active_minutes_low}/${lone.active_minutes_high})`);
assert(lone.reading_minutes_low === 5 && lone.reading_minutes_high === 15,
  `one-event session reading is 5/15 (got ${lone.reading_minutes_low}/${lone.reading_minutes_high})`);
assert(lone.measured_quiz_minutes === 0,
  `one-event session measured quiz is 0 (got ${lone.measured_quiz_minutes})`);
const loneSession = lone.sessions[0] || {};
assert(lone.sessions.length === 1 && loneSession.minutes === 0
  && loneSession.minutes_low === 5 && loneSession.minutes_high === 15,
  `one-event session keeps raw minutes 0 and floors 5/15 (got ${JSON.stringify(lone.sessions)})`);
assert(lone.by_course.length === 1 && lone.by_course[0].reading_minutes_low === 5
  && lone.by_course[0].reading_minutes_high === 15,
  `one-event floor is attributed to its course (got ${JSON.stringify(lone.by_course)})`);

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
assert(quizDay.sessions[0].minutes_low === 39 && quizDay.sessions[0].minutes_high === 39,
  `39-min quiz session floor does not bind (got ${JSON.stringify(quizDay.sessions)})`);

// AC5: a 1-minute quiz pair keeps its measured minute; the floor lifts the
// session to 5/15, with the residual attributed to reading (4/14).
const quick = toDayJson({ date: "2026-09-17", events: [
  ev("v1", "2026-09-17T21:00:00", "quiz_viewed", "Module 1 Quiz"),
  ev("s1", "2026-09-17T21:01:00", "quiz_submitted", "Module 1 Quiz"),
]});
assert(quick.measured_quiz_minutes === 1, `1-min pair measures 1 (got ${quick.measured_quiz_minutes})`);
assert(quick.active_minutes_low === 5 && quick.active_minutes_high === 15,
  `1-min quiz floor lifts active to 5/15 (got ${quick.active_minutes_low}/${quick.active_minutes_high})`);
assert(quick.reading_minutes_low === 4 && quick.reading_minutes_high === 14,
  `floor residual becomes reading 4/14 (got ${quick.reading_minutes_low}/${quick.reading_minutes_high})`);
assert(quick.active_minutes_low === quick.measured_quiz_minutes + quick.reading_minutes_low
  && quick.active_minutes_high === quick.measured_quiz_minutes + quick.reading_minutes_high,
  "active = measured quiz + reading under the floor");

// R4: page gap of 29 min -> low capped at 15, high capped at 30.
const near = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:29:00", "page_viewed"),
]});
assert(near.reading_minutes_low === 15, `29-min gap low cap 15 (got ${near.reading_minutes_low})`);
assert(near.reading_minutes_high === 29, `29-min gap high counts 29 (got ${near.reading_minutes_high})`);
assert(near.active_minutes_low === 15 && near.active_minutes_high === 29, "active follows reading");

// R4/AC2: a >=45-min gap splits sessions; each one-event session is floored
// to 5/15, so the idle gap itself still contributes no measured reading.
const over = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:46:00", "page_viewed"),
]});
assert(over.sessions.length === 2, `46-min gap splits sessions (got ${over.sessions.length})`);
assert(over.sessions.every((s) => s.minutes === 0 && s.minutes_low === 5 && s.minutes_high === 15),
  `each one-event session is floored 5/15 (got ${JSON.stringify(over.sessions)})`);
assert(over.active_minutes_low === 10 && over.active_minutes_high === 30,
  `two floored sessions -> active 10/30 (got ${over.active_minutes_low}/${over.active_minutes_high})`);
assert(over.reading_minutes_low === 10 && over.reading_minutes_high === 30,
  `two floored sessions -> reading 10/30 (got ${over.reading_minutes_low}/${over.reading_minutes_high})`);

// AC3: a 20-min gap is already above the floor, so the floor does not bind.
const twenty = toDayJson({ date: "2026-09-17", events: [
  ev("a", "2026-09-17T14:00:00", "page_viewed"),
  ev("b", "2026-09-17T14:20:00", "page_viewed"),
]});
assert(twenty.active_minutes_low === 15 && twenty.active_minutes_high === 20,
  `20-min gap -> active 15/20 (got ${twenty.active_minutes_low}/${twenty.active_minutes_high})`);
assert(twenty.reading_minutes_low === 15 && twenty.reading_minutes_high === 20,
  `20-min gap -> reading 15/20 (got ${twenty.reading_minutes_low}/${twenty.reading_minutes_high})`);

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
assert(ma.reading_minutes_high === 5 && wh.reading_minutes_high === 10,
  `floor residual 5 goes to the terminal event's course (got ${ma.reading_minutes_high}/${wh.reading_minutes_high})`);

// AC9: --rebuild regenerates every day file and the manifest from the store,
// leaving status.json untouched.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "excel-rebuild-"));
  const eventsDir = path.join(tmp, "data", "events");
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(path.join(eventsDir, "2026-10-26.json"), JSON.stringify({
    date: "2026-10-26",
    events: [
      ev("r1", "2026-10-26T11:04:19", "page_viewed", "Page", "Biology EHS"),
      ev("r2", "2026-10-26T13:03:30", "page_viewed", "Page", "Biology EHS"),
    ],
  }), "utf8");
  const statusRaw = '{"fetched_at":"2026-10-26T21:07:43.249Z"}\n';
  fs.writeFileSync(path.join(tmp, "data", "status.json"), statusRaw);
  const run = spawnSync(process.execPath, [path.join(__dirname, "..", "summarize.js"), "--rebuild"],
    { cwd: tmp, encoding: "utf8" });
  assert(run.status === 0, `--rebuild exits 0 (got ${run.status}: ${run.stderr})`);
  const rebuilt = JSON.parse(fs.readFileSync(path.join(tmp, "data", "2026-10-26.json"), "utf8"));
  assert(rebuilt.active_minutes_low === 10 && rebuilt.active_minutes_high === 30,
    `--rebuild floors both one-event sessions to 10/30 (got ${rebuilt.active_minutes_low}/${rebuilt.active_minutes_high})`);
  const index = JSON.parse(fs.readFileSync(path.join(tmp, "data", "index.json"), "utf8"));
  assert(index.length === 1 && index[0] === "data/2026-10-26.json",
    `--rebuild writes the sorted manifest (got ${JSON.stringify(index)})`);
  assert(fs.readFileSync(path.join(tmp, "data", "status.json"), "utf8") === statusRaw,
    "--rebuild leaves status.json untouched");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// AC18: writeStatus records the pipeline retrieval timestamp for every run.
assert(typeof writeStatus === "function", "summarize exports writeStatus");
if (typeof writeStatus === "function") {
  const explicitDir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-status-"));
  const returned = writeStatus(explicitDir, { fetched_at: "2026-09-20T21:08:00Z" });
  const explicitRaw = fs.readFileSync(path.join(explicitDir, "status.json"), "utf8");
  const explicit = JSON.parse(explicitRaw);
  assert(explicit.fetched_at === "2026-09-20T21:08:00Z",
    `explicit fetched_at is written verbatim (got ${explicit.fetched_at})`);
  assert(returned && returned.fetched_at === "2026-09-20T21:08:00Z", "writeStatus returns the written object");
  assert(explicitRaw.endsWith("\n"), "status.json ends with a trailing newline");
  fs.rmSync(explicitDir, { recursive: true, force: true });

  const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "excel-status-"));
  writeStatus(fallbackDir, {});
  const fallback = JSON.parse(fs.readFileSync(path.join(fallbackDir, "status.json"), "utf8"));
  assert(typeof fallback.fetched_at === "string" && !Number.isNaN(Date.parse(fallback.fetched_at)),
    `missing fetched_at falls back to a valid ISO timestamp (got ${fallback.fetched_at})`);
  fs.rmSync(fallbackDir, { recursive: true, force: true });
}

console.log(failures ? "summarize.test.js FAILED" : "summarize.test.js ok");
process.exit(failures ? 1 : 0);
