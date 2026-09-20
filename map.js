// Map server activity-log events -> raw events v2 (ET local time, kinds, no PII).
"use strict";

const DEFAULT_TIMEZONE = "America/New_York";
const EVENT_FIELDS = ["id", "at_utc", "at", "kind", "item", "course", "context_id"];

function toET(iso, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (k) => parts.find((p) => p.type === k).value;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}

function mapKind(contextType, activityType) {
  const context = String(contextType || "").toLowerCase();
  const action = String(activityType || "").toLowerCase();
  if (context === "quiz") {
    if (action === "submit") return "quiz_submitted";
    if (action === "view") return "quiz_viewed";
    return "other";
  }
  if (context === "page" && action === "view") return "page_viewed";
  return "other";
}

function mapActivity(serverEvents, { timezone = DEFAULT_TIMEZONE } = {}) {
  return (serverEvents || []).map((e) => ({
    id: String(e.student_activity_id),
    at_utc: e.created_at,
    at: toET(e.created_at, timezone),
    kind: mapKind(e.context_type, e.activity_type),
    item: e.content_name || "",
    course: e.course_instance_name || "Uncategorized",
    context_id: e.context_id == null ? "" : String(e.context_id),
  }));
}

module.exports = { DEFAULT_TIMEZONE, EVENT_FIELDS, toET, mapKind, mapActivity };
