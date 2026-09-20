// R2 — server activity events -> raw events v2 (UTC->ET, kind map, PII drop).
const { mapActivity, toET, mapKind } = require("../map.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

assert(toET("2026-09-18T01:21:19.632Z") === "2026-09-17T21:21:19",
  `known UTC->ET row (got ${toET("2026-09-18T01:21:19.632Z")})`);
assert(toET("2026-01-15T00:30:00.000Z") === "2026-01-14T19:30:00",
  `winter DST conversion (got ${toET("2026-01-15T00:30:00.000Z")})`);

assert(mapKind("page", "view") === "page_viewed", "page/view -> page_viewed");
assert(mapKind("quiz", "view") === "quiz_viewed", "quiz/view -> quiz_viewed");
assert(mapKind("quiz", "submit") === "quiz_submitted", "quiz/submit -> quiz_submitted");
assert(mapKind("page", "submit") === "other", "page/submit -> other");
assert(mapKind("video", "play") === "other", "unknown combo -> other");

const server = [
  { student_activity_id: "25206737", created_at: "2026-09-18T01:21:19.632Z",
    context_type: "quiz", activity_type: "submit", content_name: "Module 1 Quiz",
    course_instance_name: "Media Arts EHS", context_id: "16094", module_id: "187",
    enr_id: 299315, remote_ip: "68.106.92.134", user_agent: "UA", studentName: "Z" },
  { student_activity_id: "25205968", created_at: "2026-09-18T01:01:52.884Z",
    context_type: "page", activity_type: "view", content_name: "Section 1.9",
    course_instance_name: "Media Arts EHS", context_id: "1001", module_id: "187",
    enr_id: 299315, remote_ip: "68.106.92.134", user_agent: "UA", studentName: "Z" },
];
const mapped = mapActivity(server);
assert(mapped.length === 2, "maps every server event");
assert(mapped[0].id === "25206737", "keeps student_activity_id as id");
assert(mapped[0].at_utc === "2026-09-18T01:21:19.632Z", "keeps server UTC ms");
assert(mapped[0].at === "2026-09-17T21:21:19", "ET local seconds");
assert(mapped[0].kind === "quiz_submitted", "kind mapped");
assert(mapped[0].item === "Module 1 Quiz" && mapped[0].course === "Media Arts EHS", "item/course kept");
assert(mapped[0].context_id === "16094", "context_id kept");
assert(JSON.stringify(Object.keys(mapped[0]).sort())
  === JSON.stringify(["at", "at_utc", "context_id", "course", "id", "item", "kind"]),
  `only safe fields exported (got ${Object.keys(mapped[0]).join(",")})`);
assert(!JSON.stringify(mapped).match(/remote_ip|user_agent|studentName|enr_id|module_id/),
  "API PII fields dropped");

console.log(failures ? "map.test.js FAILED" : "map.test.js ok");
process.exit(failures ? 1 : 0);
