// R6 — committed event store: dedupe by id, incremental select, per-day files.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { eventKey, selectNewEvents, mergeEvents, groupByDay, loadStore, writeStore } = require("../store.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const ev = (id, atUtc) => ({ id, at_utc: atUtc, at: atUtc.slice(0, 19), kind: "page_viewed",
  item: "x", course: "c", context_id: "1" });

assert(eventKey(ev("9", "2026-09-17T20:00:00.000Z")) === "9", "eventKey is the server id");

const stored = [ev("1", "2026-09-17T20:00:00.000Z"), ev("2", "2026-09-17T20:10:00.000Z")];
const fetched = [ev("3", "2026-09-17T20:20:00.000Z"), ev("2", "2026-09-17T20:10:00.000Z"), ev("1", "2026-09-17T20:00:00.000Z")];
assert(selectNewEvents(stored, fetched).map((e) => e.id).join(",") === "3",
  "selectNewEvents returns only unseen ids in fetched order");
assert(selectNewEvents([], fetched).length === 3, "empty store returns the whole fetch");

const merged = mergeEvents(stored, [ev("2", "2026-09-17T20:10:00.000Z"), ev("3", "2026-09-17T20:20:00.000Z")]);
assert(merged.map((e) => e.id).join(",") === "1,2,3", "mergeEvents dedupes by id and sorts");

const byDay = groupByDay(merged);
assert(byDay.get("2026-09-17").length === 3, "groupByDay buckets by ET date");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
const first = writeStore(dir, merged);
assert(first.changedDays.join(",") === "2026-09-17", `first write changes the day (got ${first.changedDays})`);
const second = writeStore(dir, merged);
assert(second.changedDays.length === 0, "second identical write is a no-op");
const back = loadStore(dir);
assert(back.length === 3 && back[0].id === "1", "loadStore round-trips sorted events");
const file = path.join(dir, "2026-09-17.json");
assert(fs.existsSync(file), "store file named by ET date");
const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
assert(parsed.date === "2026-09-17" && Array.isArray(parsed.events), "store file shape {date, events[]}");

console.log(failures ? "store.test.js FAILED" : "store.test.js ok");
process.exit(failures ? 1 : 0);
