// Committed event store: per-day JSON under data/events/, deduped by server id.
"use strict";

const fs = require("fs");
const path = require("path");

const eventKey = (e) => String(e.id);
const byAt = (a, b) => {
  if (a.at_utc !== b.at_utc) return a.at_utc < b.at_utc ? -1 : 1;
  return eventKey(a).localeCompare(eventKey(b));
};

function mergeEvents(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of list || []) {
      const key = eventKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out.sort(byAt);
}

function selectNewEvents(stored, fetched) {
  const ids = new Set((stored || []).map(eventKey));
  return (fetched || []).filter((e) => !ids.has(eventKey(e)));
}

function groupByDay(events) {
  const days = new Map();
  for (const e of [...(events || [])].sort(byAt)) {
    const date = String(e.at).slice(0, 10);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(e);
  }
  return days;
}

function loadStore(dir) {
  if (!fs.existsSync(dir)) return [];
  const events = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    events.push(...(parsed.events || []));
  }
  return events.sort(byAt);
}

function writeStore(dir, events) {
  const changedDays = [];
  fs.mkdirSync(dir, { recursive: true });
  for (const [date, dayEvents] of groupByDay(events)) {
    const file = path.join(dir, `${date}.json`);
    const next = JSON.stringify({ date, events: dayEvents }, null, 2) + "\n";
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (prev !== next) {
      fs.writeFileSync(file, next);
      changedDays.push(date);
    }
  }
  return { changedDays };
}

module.exports = { eventKey, mergeEvents, selectNewEvents, groupByDay, loadStore, writeStore };
