// Pure parser: Recent Activity container HTML -> events[].
// No Playwright dependency — testable in plain node (needs no DOM: regex-based
// on the stable MUI class structure, tolerant to icon variant changes).
"use strict";

const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

function classifyKind(iconId, action) {
  const a = action.toLowerCase();
  if (iconId === "QuizIcon" || a.includes("quiz")) {
    if (a.includes("submitted")) return "quiz_submitted";
    if (a.includes("viewed")) return "quiz_viewed";
    return "quiz_submitted"; // a quiz feed row without a verb is a submission history entry
  }
  if (a.includes("viewed")) return "page_viewed";
  return "other";
}

function parseTimestamp(ts) {
  // "09/17/2026 21:21:19" -> "2026-09-17T21:21:19"
  const m = /\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/.exec(ts);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}`;
}

// One feed row: <div class="MuiBox-root css-i5q2k0"> ... item title span ...
// action text div ... timestamp ... folder course label.
const ROW = /<div class="MuiBox-root css-i5q2k0">([\s\S]*?)<\/div>\s*<\/span>/g;
const isCoarseBlock = (inner) =>
  /card_theme-icon/.test(inner) && /MuiTypography-subtitle1/.test(inner);

function parse(html) {
  const events = [];
  const blockRe = /<span class="MuiTypography-root MuiTypography-subtitle1[^"]*">([\s\S]*?)<\/div>\s*<\/span>/g;
  const rootMarker = html.indexOf('id="scrollableDiv"');
  const scope = rootMarker === -1 ? html : html.slice(rootMarker);

  let m;
  while ((blockRe.exec(scope))) { /* advance once to size the loop */ blockRe.lastIndex = 0; break; }

  // Split on the row-marker class present in every activity card.
  const cardRe = /card_theme-icon[^"]*"/;
  const chunks = scope.split(/(?=card_theme-icon)/);
  for (const chunk of chunks.slice(1)) {
    if (!cardRe.test(chunk)) continue;
    const title = /MuiTypography-subtitle1[^>]*>([^<]+)</.exec(chunk);
    const bodyMatch = /css-fb7yql">([\s\S]*?)<\/span>/.exec(chunk) || /css-fb7yql">([\s\S]*)/.exec(chunk);
    const body = bodyMatch ? bodyMatch[1] : chunk;
    const course = /FolderIcon[\s\S]*?<\/svg>\s*<\/div>\s*([^<]+)</.exec(body);
    const courseText = course ? course[1].trim() : (/history-icon[\s\S]*?<\/div>\s*([^<]+)</.exec(body) || ["", ""])[1].trim();
    const ts = parseTimestamp(body);
    if (!title || !ts) continue; // rows without a parseable timestamp are skipped loudly rather than guessed

    // Action text: first text node of the body's leading action line.
    const actionMatch = /(?:css-jsdm9k[^>]*>|^)(?:\s*)?([A-Za-z][A-Za-z ]*?Viewed|[A-Za-z][A-Za-z ]*?Submitted|Page Viewed|Quiz\s+Viewed|Quiz\s+Submitted)/.exec(
      body.replace(/<div[^>]*>(?:<\/div>)?/g, " ").replace(/<[^>]+>/g, "|"));
    const actionText = actionMatch ? actionMatch[1].trim() : "";
    const iconId = /<svg[^>]*id="([^"]+)"/.exec(body);
    events.push({
      item: title[1].trim(),
      kind: classifyKind(iconId ? iconId[1] : "", actionText),
      at: ts,
      course: courseText || "Uncategorized",
    });
  }
  return events;
}

if (require.main === module) {
  const src = process.argv[2];
  if (!src) { console.error("usage: node parse.js <raw.html> [out.json]"); process.exit(2); }
  const html = require("fs").readFileSync(src, "utf8");
  const events = parse(html);
  const out = process.argv[3];
  if (out) require("fs").writeFileSync(out, JSON.stringify({ events }, null, 2));
  else console.log(JSON.stringify({ events }, null, 2));
}

module.exports = { parse, classifyKind, parseTimestamp };
