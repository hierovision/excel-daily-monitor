// AC2 — parser handles the real Recent Activity DOM shape.
const fs = require("fs");
const path = require("path");
const { parse } = require("../parse.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

const html = fs.readFileSync(path.join(__dirname, "fixtures", "recent-activity.html"), "utf8");
const events = parse(html);

assert(events.length >= 16, `parsed >=16 events, got ${events.length}`);
assert(events.every(e => e.item && e.course && e.kind && e.at), "every event has item/course/kind/at");
assert(events.every(e => e.kind === "page_viewed" || e.kind === "quiz_viewed" || e.kind === "quiz_submitted" || e.kind === "other"),
  "kind is a known value");

const m1Submit = events.find(e => e.item === "Module 1 Quiz" && e.kind === "quiz_submitted");
assert(m1Submit, "Module 1 Quiz submitted event exists");
assert(m1Submit.at === "2026-09-17T21:21:19", `Module 1 Quiz submitted at 2026-09-17T21:21:19, got ${m1Submit && m1Submit.at}`);
const m1View = events.find(e => e.item === "Module 1 Quiz" && e.kind === "quiz_viewed");
assert(m1View && m1View.at === "2026-09-17T21:16:40", "Module 1 Quiz viewed at 21:16:40");

const mediaArts = events.filter(e => e.course === "Media Arts EHS");
const worldHist = events.filter(e => e.course === "World History EHS");
assert(mediaArts.length === 11, `Media Arts EHS 11 events, got ${mediaArts.length}`);
assert(worldHist.length === 9, `World History EHS 9 events, got ${worldHist.length}`);

// untyped icon -> kind "other", no crash
const forged = html.replace('id="OtherIcon"', 'id="UNKNOWNICON"').replace("Page Viewed", "Weird Action");
const other = parse(forged);
assert(other.some(e => e.kind === "other"), "unknown icon+action falls back to kind other without crashing");

console.log(failures ? "parse.test.js FAILED" : "parse.test.js ok");
process.exit(failures ? 1 : 0);
