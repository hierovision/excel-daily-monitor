// U1-U8 + AC1-AC23 + W1-W15 — at-a-glance band, collapsible day cards, the live
// Today layer, the compact day detail, retrieval time, the Monday-start calendar
// week, and the responsive weekly layout (Rev 2026-09-27): Today integrated
// in-list (pinned strip only when browsing away), week-range identity,
// weekday+number labels with ISO aria-labels, text state chips, CSS-only
// reflow (single column narrow, 7-track grid at desktop), focus/scroll
// survival across polls, and 12-hour time display (Rev 2026-09-27a, W12).
// Rev 2026-09-27c (W15): "Data last checked" status + "Data last imported"
// footer (ET suffix, em-dash branch). Rev 2026-09-27d (OQ2/OQ3): elapsed-day
// band denominator ("so far"; past weeks keep the full window) and 5-minute
// quantized collapse durations ("≈1h 05m"; the band/detail ranges stay raw).
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

(async () => {
  const root = path.resolve(__dirname, "..");
  const site = path.join(root, "tests", "fixtures", "site");
  const overrides = new Map();
  const hits = new Map(); // per-URL hit counter (AC9, AC12)
  const requests = []; // {method, path} request log (AC12)
  const hitCount = (u) => hits.get(u) || 0;
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    hits.set(url, (hits.get(url) || 0) + 1);
    requests.push({ method: req.method, path: url });
    const file = url.startsWith("/data/")
      ? path.join(site, url)
      : path.join(root, url === "/" ? "index.html" : url);
    const body = overrides.has(url) ? overrides.get(url) : (fs.existsSync(file) ? fs.readFileSync(file) : null);
    if (body !== null) {
      res.setHeader("Content-Type", file.endsWith(".json") ? "application/json" : "text/html");
      if (url.endsWith(".json")) res.setHeader("Cache-Control", "max-age=600");
      res.end(body);
    } else { res.statusCode = 404; res.end("nf"); }
  });
  await new Promise((r) => server.listen(8931, r));

  const browser = await chromium.launch();

  // ---------- shared helpers (red-safe: never throw on a missing element) ----------
  const newPage = async ({ now, pollMs, width = 390, height = 844 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(5000);
    const pageerrors = [];
    page.on("pageerror", (e) => pageerrors.push(String(e)));
    if (now !== undefined || pollMs !== undefined) {
      await page.addInitScript(([n, p]) => {
        if (n !== undefined) window.__now = n;
        if (p !== undefined) window.__pollMs = p;
      }, [now, pollMs]);
    }
    return { page, pageerrors };
  };
  const openPage = async (opts = {}) => {
    const { page, pageerrors } = await newPage(opts);
    await page.goto("http://localhost:8931/", { waitUntil: "load" });
    return { page, pageerrors };
  };
  const readText = async (locator) => {
    try { return norm(await locator.first().textContent({ timeout: 1000 })); } catch { return ""; }
  };
  const textIfPresent = (page, sel) => readText(page.locator(sel));
  const getAttr = async (locator, name) => {
    try { if (await locator.count() === 0) return null; return await locator.first().getAttribute(name, { timeout: 1000 }); } catch { return null; }
  };
  const safeVisible = async (locator) => {
    try { return await locator.first().isVisible({ timeout: 1000 }); } catch { return false; }
  };
  const safeHidden = async (locator) => {
    try { return await locator.first().isHidden({ timeout: 1000 }); } catch { return false; }
  };
  const safeClick = async (locator) => {
    try { await locator.first().click({ timeout: 1000 }); return true; } catch { return false; }
  };
  const safeEval = async (locator, fn) => {
    try { if (await locator.count() === 0) return null; return await locator.first().evaluate(fn); } catch { return null; }
  };
  const ev = async (locator, fn) => {
    try { if (await locator.count() === 0) return null; return await locator.first().evaluate(fn); } catch { return null; }
  };
  const clickIf = async (locator) => {
    try { await locator.click({ timeout: 1000 }); return true; } catch { return false; }
  };
  const disabledIfPresent = async (locator) => {
    try { if (await locator.count() === 0) return null; return await locator.isDisabled(); } catch { return null; }
  };
  const waitSel = async (page, sel, timeout = 3000) => {
    try { await page.waitForSelector(sel, { timeout }); return true; } catch { return false; }
  };
  const waitFn = async (page, fn, arg, timeout = 3000) => {
    try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch { return false; }
  };
  const waitNode = async (fn, timeout = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };
  // Rev 2026-09-27 (W4): the collapsed line shows "Mon 14"; the ISO day identity
  // lives in the day-title's aria-label ("Monday, 2026-09-14") — helpers key off
  // it, with a fallback to ISO-in-text so pre-revision pages stay inspectable.
  const titles = (page) => page.$$eval("[data-testid=day-title]", (els) => els.map((el) => {
    const label = (el.getAttribute("aria-label") || "").split(", ").pop();
    return label || (el.textContent || "").trim();
  }));
  const waitAnchor = (page, date) => waitFn(page, (d) => {
    const el = document.querySelector("[data-testid=day-title]");
    if (!el) return false;
    const label = (el.getAttribute("aria-label") || "").split(", ").pop();
    return (label || (el.textContent || "").trim()) === d;
  }, date, 5000);
  const cardFor = (page, iso) => {
    const byLabel = page.locator("[data-testid=day-card]").filter({
      has: page.locator(`[data-testid=day-title][aria-label$="${iso}"]`),
    });
    return byLabel.first()
      .or(page.locator("[data-testid=day-card]").filter({ has: page.locator("[data-testid=day-title]", { hasText: iso }) }).first())
      .first();
  };
  const fixture = (date) => JSON.parse(fs.readFileSync(path.join(site, "data", `${date}.json`), "utf8"));
  // Rev 2026-09-27b (W13/W14): geometry of the current-anchoring viewport.
  // "Anchored" = the page scrolled to Today's card optimum: its top edge at the
  // viewport top when the scroll allows, else as far down as the document goes
  // (mid-week the card sits deep in a Mon→Sun list, so the browser clamps —
  // scrollY === min(offsetTop, maxScroll) is the exact spec). The band's bottom
  // edge above the viewport top keeps it reachable by scrolling up. Nulls mean
  // the in-list Today card did not render (past week → pinned strip).
  const todayGeo = (page) => page.$eval("#days", (root) => {
    const anchor = root.querySelector("[data-testid=day-card] [data-testid=today]");
    const band = document.querySelector("[data-testid=week-band]");
    const de = document.documentElement;
    const maxScroll = Math.round(de.scrollHeight - de.clientHeight);
    if (!anchor) return { scrollY: Math.round(window.scrollY), offsetTop: null, todayTop: null, bandBottom: null, maxScroll, overflow: de.scrollHeight > de.clientHeight };
    const card = anchor.closest("[data-testid=day-card]");
    const offsetTop = Math.round(card.getBoundingClientRect().top + window.scrollY);
    return {
      scrollY: Math.round(window.scrollY),
      offsetTop,
      todayTop: Math.round(card.getBoundingClientRect().top),
      bandBottom: band ? Math.round(band.getBoundingClientRect().bottom) : null,
      maxScroll,
      overflow: de.scrollHeight > de.clientHeight,
    };
  }).catch(() => ({ scrollY: 0, offsetTop: null, todayTop: null, bandBottom: null, maxScroll: 0, overflow: false }));

  // ================= legacy U1-U8 page (pinned to the fixture week) =================
  const A = await openPage({ now: "2026-09-17T20:00:00Z" });
  const page = A.page;
  const pageerrors = A.pageerrors;
  await page.waitForSelector("[data-testid=day-card]");

  // ---------- W1/W2 (Rev 2026-09-27): current-week single flow ----------
  // Supersedes AC1's "Today precedes week band" for the current-week case.
  const w1Order = await ev(page.locator("[data-testid=week-band]"), (band) => {
    const legend = document.querySelector("[data-testid=legend]");
    const cards = [...document.querySelectorAll("#days [data-testid=day-card]")];
    const today = document.querySelector("[data-testid=today]");
    const follows = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    const asc = cards.map((c) => { const t = c.querySelector("[data-testid=day-title]"); return t ? (t.getAttribute("aria-label") || "").split(", ").pop() : ""; });
    return {
      bandBeforeLegend: follows(band, legend),
      legendBeforeFirst: follows(legend, cards[0]),
      bandBeforeToday: follows(band, today),
      cardCount: cards.length,
      ascending: asc.join(",") === ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].join(","),
    };
  });
  assert(w1Order && w1Order.bandBeforeLegend === true, "W1 week band precedes the legend");
  assert(w1Order && w1Order.legendBeforeFirst === true, "W1 legend precedes the day list");
  assert(w1Order && w1Order.cardCount === 7 && w1Order.ascending === true, `W1 seven day cards ascending Mon→Sun (got ${JSON.stringify(w1Order)})`);
  assert(w1Order && w1Order.bandBeforeToday === true, "W1 the Today layer follows the band — no Today section precedes it (Rev 2026-09-27 supersedes AC1 order)");
  assert(await page.locator("[data-testid=today]").count() === 1, `W1/W2 exactly one [data-testid=today] (got ${await page.locator("[data-testid=today]").count()})`);
  const todayInCard = await ev(page.locator("[data-testid=today]"), (el) => !!el.closest("[data-testid=day-card]"));
  assert(todayInCard === true, "W1 the Today layer lives inside the in-list day card");
  const todayCard = cardFor(page, "2026-09-17");
  assert(await todayCard.locator("[data-testid=day-today]").count() === 1, "W1/W5 the Today card carries a text Today chip");
  assert(await readText(todayCard.locator("[data-testid=day-today]")) === "Today", `W5 Today chip text (got "${await readText(todayCard.locator("[data-testid=day-today]"))}")`);
  assert(await todayCard.locator("[data-testid=today-status]").count() === 1, "W2 the in-list card hosts today-status");
  assert(await todayCard.locator("[data-testid=today-refresh]").count() === 1, "W2 the in-list card hosts today-refresh");

  // ---------- U2/AC20 (setup): 7 day rows, calendar week ascending ----------
  let t = await titles(page);
  assert(t.length === 7, `default window shows 7 day rows (got ${t.length})`);
  assert(t.join(",") === ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].join(","),
    `AC20 default window is the current calendar week ascending (got ${t.join(",")})`);

  // ---------- U1/AC20/W4: week band (current calendar week) + week identity ----------
  assert(await page.locator("[data-testid=week-band]").count() === 1, "exactly one week band");
  // Rev 2026-09-27 (W9): supersedes the "week band is aria-live=polite" assertion —
  // the band drops aria-live; today-status stays the single live region.
  assert((await getAttr(page.locator("[data-testid=week-band]"), "aria-live")) === null, "W9 week band carries no aria-live");
  assert(await textIfPresent(page, "[data-testid=week-range]") === "Sep 14 – 20, 2026",
    `W4 week-range line (got "${await textIfPresent(page, "[data-testid=week-range]")}")`);
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    `AC20 current-week heading is This week (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => ""))}")`);
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 4 of 4 days so far",
    `AC20/OQ2 default band worked line (got "${await textIfPresent(page, "[data-testid=week-worked]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 48m–4h 44m",
    `AC20 default band active line is the calendar-week total (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 1",
    `AC20 default band quizzes line (got "${await textIfPresent(page, "[data-testid=week-quizzes]")}")`);
  const weekSubs = page.locator("[data-testid=week-band] details");
  assert(norm(await weekSubs.locator("summary").textContent().catch(() => "")) === "Show submissions", "band submissions behind a disclosure");
  await safeClick(weekSubs.locator("summary"));
  assert(await safeVisible(weekSubs.getByText("Submitted: Module 1 Quiz — Media Arts EHS")), "band submission item visible when opened");
  await safeClick(weekSubs.locator("summary"));

  // ---------- OQ2 (Rev 2026-09-27d): elapsed-day denominator on the current week ----------
  // Thu 2026-09-17 at 20:00Z (16:00 ET): Mon..Thu elapsed INCLUSIVE = 4, all
  // carried by activity files → "Worked 4 of 4 days so far" (the user's
  // "4 of 5" example corresponds to a Friday clock). Sat 2026-09-19 04:01 UTC
  // = 00:01 ET Sat → 6 elapsed with worked 4 → "Worked 4 of 6 days so far"
  // (future markers never count as worked). Past weeks keep the full window.
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 4 of 4 days so far",
    `OQ2 current-week band uses the elapsed denominator (got "${await textIfPresent(page, "[data-testid=week-worked]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 48m–4h 44m",
    `OQ2 the active range stays the raw calendar-week total (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  {
    const sat = await openPage({ now: "2026-09-19T04:01:00Z" }); // 00:01 ET Sat 19 (past the AC3 04:00Z boundary)
    const sp2 = sat.page;
    await waitSel(sp2, "[data-testid=day-card]");
    const todayIso = await textIfPresent(sp2, "[data-testid=today-date]");
    assert(todayIso === "2026-09-19", `OQ2 setup: ET day is Sat 2026-09-19 (got "${todayIso}")`);
    assert(await textIfPresent(sp2, "[data-testid=week-worked]") === "Worked 4 of 6 days so far",
      `OQ2 denominator includes Today (Sat; 6 elapsed days Mon..Sat) (got "${await textIfPresent(sp2, "[data-testid=week-worked]")}")`);
    assert(await sp2.locator("[data-testid=day-card] [data-testid=today]").count() === 1, "OQ2 setup: Today still renders in-list");
    await sp2.close();
  }

  // ---------- U2/W4/W5/W6: collapsed day lines, labels, chips, justified rows ----------
  assert(await page.locator("[data-testid=day-summary]").count() === 4, `only active days are expandable (got ${await page.locator("[data-testid=day-summary]").count()} summaries)`);
  const top = todayCard;
  const firstLabel = norm(await page.locator("[data-testid=day-title]").first().textContent().catch(() => ""));
  assert(firstLabel === "Mon 14", `W4 collapsed label is weekday+day number (got "${firstLabel}")`);
  const topSummaryText = norm(await top.locator("[data-testid=day-summary]").textContent().catch(() => ""));
  assert(topSummaryText.includes("Thu 17") && topSummaryText.includes("Today") && topSummaryText.includes("≈1h 05m active") && topSummaryText.includes("Quiz submitted"),
    `OQ3/W15: collapsed line carries the quantized ≈ duration (got "${topSummaryText}")`);
  const s16 = norm(await cardFor(page, "2026-09-16").locator("[data-testid=day-summary]").textContent().catch(() => ""));
  assert(s16.includes("Wed 16") && s16.includes("≈1h 05m active") && !/quiz/i.test(s16),
    `OQ3 collapsed line quantizes the 65-min centre to ≈1h 05m (got "${s16}")`);
  assert((await ev(cardFor(page, "2026-09-16").locator("[data-testid=day-summary]"), (e) => getComputedStyle(e).justifyContent)) === "space-between",
    "W6 collapsed row justifies label left / duration right");
  assert((await getAttr(page.locator("[data-testid=day-title]").first(), "aria-label")) === "Monday, 2026-09-14",
    `W4 day-title aria-label is "Monday, 2026-09-14"-style (got "${await getAttr(page.locator("[data-testid=day-title]").first(), "aria-label")}")`);
  // OQ3 + W15: collapsed durations are the 5-min-quantized centre ("about"
  // dropped); the band/detail ranges and course/session values stay raw.
  const collapsedLines = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => (e.textContent || "").replace(/\s+/g, " ")));
  assert(collapsedLines.length === 4 && collapsedLines.every((s) => /≈\d/.test(s) && !/about /.test(s)),
    `OQ3 every collapsed line quantizes with the ≈ prefix — no "about " remains (got ${JSON.stringify(collapsedLines)})`);
  assert(!collapsedLines.some((s) => /≈\d+h \d{2}[13-8]m/.test(s)), "OQ3 non-5-multiple minute buckets absent (67→05, 65→05)");
  const quantParts = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => {
    const m = (e.textContent || "").match(/≈\s*(?:(\d+)h\s)?(\d{1,2})m/);
    return m ? { h: m[1] ? Number(m[1]) : 0, m: Number(m[2]) } : null;
  }));
  assert(quantParts.length === 4 && quantParts.every((p) => p && (p.h * 60 + p.m) % 5 === 0),
    `OQ3 collapsed minute buckets are multiples of 5 (got ${JSON.stringify(quantParts)})`);
  for (const sel of ["active-minutes", "quiz-line", "reading-line", "courses", "sessions", "submissions"]) {
    assert(await safeHidden(cardFor(page, "2026-09-16").locator(`[data-testid=${sel}]`)), `detail ${sel} hidden before expansion`);
  }
  assert(await page.locator("[data-testid=first-last]").count() === 0, "first-last testid is gone");
  for (const date of ["2026-09-18", "2026-09-19", "2026-09-20"]) {
    const card = cardFor(page, date);
    // Rev 2026-09-27 (W5): supersedes the muted "—" future marker with a text chip.
    const futureLabel = `${new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${Number(date.slice(8, 10))}`;
    assert(await readText(card) === `${futureLabel} Not yet`,
      `W5 future day ${date} renders the Not yet chip (got "${await readText(card)}")`);
    assert(await card.locator("[data-testid=day-future]").count() === 1, `W5 future day ${date} carries day-future`);
    assert(await card.locator("[data-testid=day-summary]").count() === 0, `W5 future day ${date} is non-interactive (no disclosure)`);
    assert(!/no activity|No activity/.test(await readText(card)), `future day ${date} is not no-activity`);
  }

  // ---------- U3: progressive disclosure on a sibling day (compact strings) ----------
  const second = cardFor(page, "2026-09-16");
  await safeClick(second.locator("[data-testid=day-summary]"));
  assert(await second.locator("[data-testid=day-detail]").count() === 1, "expanded card exposes the shared day-detail wrapper");
  assert(await safeVisible(second.locator("[data-testid=day-date]")), "W4 expanded detail header repeats the full ISO date");
  assert(await readText(second.locator("[data-testid=day-date]")) === "2026-09-16", `W4 detail date line (got "${await readText(second.locator("[data-testid=day-date]"))}")`);
  assert(await safeVisible(second.locator("[data-testid=active-minutes]")), "active line visible after expansion");
  assert(await readText(second.locator("[data-testid=active-minutes]")) === "58m–1h 12m",
    `active detail value (got "${await readText(second.locator("[data-testid=active-minutes]"))}")`);
  assert(await readText(second.locator("[data-testid=quiz-line]")) === "24m",
    `measured quiz detail value (got "${await readText(second.locator("[data-testid=quiz-line]"))}")`);
  assert(await readText(second.locator("[data-testid=reading-line]")) === "34m–48m",
    `reading detail value (got "${await readText(second.locator("[data-testid=reading-line]"))}")`);
  let courses = await second.locator("[data-testid=course-line]").allTextContents().catch(() => []);
  assert(courses.map(norm).join(" | ") === "Media Arts EHS 58m | World History EHS 10m",
    `course lines use the low estimate without an "active" suffix (got ${JSON.stringify(courses)})`);
  const sessions = second.locator("[data-testid=sessions]");
  // W12 (Rev 2026-09-27a): 12-hour with shared meridiem collapsed once.
  assert(norm(await sessions.locator("summary").textContent().catch(() => "")) === "Sessions (1) · 4:00–5:30 PM",
    `W12 sessions summary merges the count and first-last (got "${norm(await sessions.locator("summary").textContent().catch(() => ""))}")`);
  await safeClick(sessions.locator("summary"));
  assert(await readText(sessions.locator("li").first()) === "4:00–5:30 PM", `W12 session segment (got "${await readText(sessions.locator("li"))}")`);
  await safeClick(sessions.locator("summary"));
  assert(await safeVisible(top.locator("[data-testid=submissions]").getByText("Media Arts EHS — Module 1 Quiz · 5:21 PM")),
    "W12 submission renders course-first with a 12-hour time (on the open Today card)");
  await safeClick(second.locator("[data-testid=day-summary]"));
  assert(await safeHidden(second.locator("[data-testid=day-detail]")), "day detail hides again when collapsed");

  // keyboard toggle on the Today card (open by default → Enter collapses)
  const topSummary = top.locator("[data-testid=day-summary]");
  try { await topSummary.focus({ timeout: 1000 }); } catch {}
  await page.keyboard.press("Enter");
  assert(await safeHidden(top.locator("[data-testid=active-minutes]")), "keyboard collapses the default-open Today card");
  await page.keyboard.press("Enter");
  assert(await safeVisible(top.locator("[data-testid=active-minutes]")), "keyboard re-expands the Today card");

  // ---------- U4: bars removed ----------
  assert(await page.locator(".bar").count() === 0, "no bar elements remain");

  // ---------- U5 + W15: single week-level footer ("Data last imported") ----------
  assert(await page.locator("[data-testid=week-footer]").count() === 1, "exactly one week footer");
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data last imported 2026-09-17 5:30 PM ET",
    `W15 footer shows the import stamp with ET (got "${await textIfPresent(page, "[data-testid=week-footer]")}")`);
  assert(await page.locator("[data-testid=data-as-of]").count() === 0, "per-card data-as-of removed");

  // ---------- U6: accessibility (compact contract) + AC15 ----------
  assert(await page.locator('nav[aria-label="Week navigation"]').count() === 1, "week navigation is a labelled nav");
  const nav = page.locator('nav[aria-label="Week navigation"]');
  assert(await nav.locator("[data-testid=prev-week]").count() === 1 &&
    await nav.locator("[data-testid=picker]").count() === 1 &&
    await nav.locator("[data-testid=next-week]").count() === 1, "nav wraps prev/picker/next");
  assert(await page.locator("h1").count() === 1, "page has one h1");
  assert((await ev(page.locator("[data-testid=day-title]").first(), (e) => e.tagName)) === "H3", "day dates are h3");
  const picker = page.locator("[data-testid=picker]");
  assert((await getAttr(picker, "min")) === "2026-08-31", `AC22 picker min is the earliest data week's Monday (got ${await getAttr(picker, "min")})`);
  assert((await getAttr(picker, "max")) === "2026-09-17", `AC22 picker max is today, not a future week (got ${await getAttr(picker, "max")})`);
  assert((await picker.inputValue().catch(() => "")) === "2026-09-14", `picker value is the week anchor (got ${await picker.inputValue().catch(() => "")})`);
  // W13 (Rev 2026-09-27b): the picker is an anchor trigger when it lands on the
  // current week — the current-week window re-anchors at Today's card.
  await safeClick(second.locator("[data-testid=day-summary]"));
  assert(await second.locator("[data-testid=day-detail]").count() === 1, "AC15 setup: detail present to inspect");
  // AC15 — the visible dt is the accessible label for its dd; no aria-label restatement.
  const activeAttrs = await ev(second.locator("[data-testid=day-detail] [data-testid=active-minutes]"), (e) => ({
    tag: e.tagName,
    parent: e.parentElement && e.parentElement.tagName,
    prev: e.previousElementSibling && e.previousElementSibling.textContent.trim(),
  }));
  assert(activeAttrs && activeAttrs.tag === "DD" && activeAttrs.parent === "DL" && activeAttrs.prev === "Active",
    `active-minutes is a dd whose previous dt is Active (got ${JSON.stringify(activeAttrs)})`);
  assert(await second.locator("[data-testid=day-detail] [aria-label]").count() === 0, "no aria-label restatement inside the detail");
  const activeSnap = await ev(second.locator("[data-testid=day-detail] dl"), (e) => e.textContent);
  const activeSnapText = activeSnap || "";
  assert(activeSnapText.includes("Active") && activeSnapText.includes("58m–1h 12m"),
    `dl carries the label and value (got ${JSON.stringify(activeSnapText)})`);
  // Rev 2026-09-27 (W4): the day's accessible name is the ISO date; the visible
  // label is weekday+number; the expanded detail repeats the full date.
  const dayTitleSnap = await ev(second.locator("[data-testid=day-title]"), (e) => ({
    name: (e.getAttribute("aria-label") || "").trim(),
    text: (e.textContent || "").trim(),
  }));
  assert(dayTitleSnap && dayTitleSnap.name === "Wednesday, 2026-09-16" && dayTitleSnap.text === "Wed 16",
    `W4 day-title accessible name + visible label (got ${JSON.stringify(dayTitleSnap)})`);
  await safeClick(second.locator("[data-testid=day-summary]"));

  // ---------- U8/W6: collapsed summaries fit 390px; no page overflow ----------
  const widths = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(widths.length === 4 && widths.every((w) => w.sw <= w.cw),
    `collapsed summaries do not overflow at 390px (got ${JSON.stringify(widths)})`);
  const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert(overflow390 === true, "W6 no horizontal page overflow at 390px");
  const rowOverflow390 = await page.$$eval("[data-testid=day-card]", (els) => els.every((e) => e.scrollWidth <= e.clientWidth));
  assert(rowOverflow390 === true, "W6 no day row overflows at 390px");

  // ---------- AC21: prev/next browse calendar weeks; the heading follows ----------
  assert(await page.locator("[data-testid=next-week]").isDisabled().catch(() => true), "AC21 next is disabled at the current week");
  await safeClick(page.locator("[data-testid=prev-week]"));
  await waitAnchor(page, "2026-09-07");
  t = await titles(page);
  assert(t.length === 7 && t[6] === "2026-09-13", `AC21 prev yields the previous calendar week (got ${t.join(",")})`);
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "Week of Sep 7",
    `AC21 heading follows the browsed week (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => ""))}")`);
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 5 of 7 days", "AC21 prev band worked (past week: full window, no so far)");
  assert(!/so far/.test(await textIfPresent(page, "[data-testid=week-worked]")), "OQ2 past weeks keep the full-window worked line");
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 40m–4h 50m",
    `AC21 prev band active (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 0", "AC21 prev band quizzes");
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data last imported 2026-09-11 5:30 PM ET", "W15 AC21 prev footer");
  assert(!(await page.locator("[data-testid=next-week]").isDisabled().catch(() => true)), "AC21 next re-enables after moving back");
  await safeClick(page.locator("[data-testid=prev-week]"));
  await waitAnchor(page, "2026-08-31");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "Week of Aug 31",
    `AC21 second prev heading (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => ""))}")`);
  // W4: month-crossing week range line.
  assert(await textIfPresent(page, "[data-testid=week-range]") === "Aug 31 – Sep 6, 2026",
    `W4 month-crossing week-range (got "${await textIfPresent(page, "[data-testid=week-range]")}")`);
  assert(await page.locator("[data-testid=prev-week]").isDisabled().catch(() => false), "AC21 prev is disabled at the earliest data week");
  const blank = cardFor(page, "2026-08-31");
  // Rev 2026-09-27 (W5): elapsed-empty days carry the "No activity" text chip.
  assert(await readText(blank) === "Mon 31 No activity",
    `W5 elapsed day with no file renders the No activity chip (got "${await readText(blank)}")`);
  assert(await blank.locator("[data-testid=day-empty-chip]").count() === 1, "W5 elapsed-empty day carries day-empty-chip");
  assert(await blank.locator("[data-testid=day-upcoming]").count() === 0, "elapsed empty day is not a future marker");
  assert(!/quiz/i.test(await readText(blank)), "elapsed empty day has no quiz badge");
  await safeClick(page.locator("[data-testid=next-week]"));
  await safeClick(page.locator("[data-testid=next-week]"));
  await waitAnchor(page, "2026-09-14");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "This week",
    "AC21 returning to the current week restores This week");

  // ---------- AC22 + U7: picker maps a date to its containing week ----------
  await page.fill("[data-testid=picker]", "2026-09-08");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor(page, "2026-09-07");
  t = await titles(page);
  assert(t[0] === "2026-09-07" && t[6] === "2026-09-13",
    `AC22 picker maps 2026-09-08 to the week of Sep 7 (got ${t.join(",")})`);
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data last imported 2026-09-11 5:30 PM ET", "W15 AC22 footer follows the mapped week");

  const v2 = cardFor(page, "2026-09-08");
  await safeClick(v2.locator("[data-testid=day-summary]"));
  assert(await readText(v2.locator("[data-testid=day-detail] [data-testid=active-minutes]")) === "42m–56m",
    "v2 day still renders a range");
  await safeClick(v2.locator("[data-testid=day-summary]"));

  await page.fill("[data-testid=picker]", "2026-09-03");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor(page, "2026-08-31");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "Week of Aug 31",
    "AC22 picker maps 2026-09-03 to the week of Aug 31");

  const v1 = cardFor(page, "2026-09-03");
  const v1Line = norm(await v1.locator("[data-testid=day-summary]").textContent().catch(() => ""));
  assert(v1Line.includes("Thu 3") && v1Line.includes("≈40m active"),
    `OQ3 v1 collapsed line quantizes the legacy single number to ≈40m (got "${v1Line}")`);
  await safeClick(v1.locator("[data-testid=day-summary]"));
  const v1active = await readText(v1.locator("[data-testid=day-detail] [data-testid=active-minutes]"));
  assert(v1active === "42m", `v1 detail shows the legacy single number (got "${v1active}")`);
  assert(!/–/.test(v1active), "v1 detail invents no range");
  assert(await readText(v1.locator("[data-testid=course-line]").first()) === "Media Arts EHS 42m",
    "v1 course line uses the legacy minutes");
  assert(await v1.locator("[data-testid=quiz-line]").count() === 0, "v1 detail does not invent measured quiz time");
  await safeClick(v1.locator("[data-testid=day-summary]"));

  // ---------- U8/W6 (browsed window): collapsed summaries fit 390px ----------
  const widths2 = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(widths2.length === 5 && widths2.every((w) => w.sw <= w.cw),
    `browsed-window summaries do not overflow at 390px (got ${JSON.stringify(widths2)})`);

  await page.fill("[data-testid=picker]", "2026-09-16");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor(page, "2026-09-14");
  t = await titles(page);
  assert(t[0] === "2026-09-14" && t[6] === "2026-09-20",
    `AC22 picker maps 2026-09-16 to the current week (got ${t.join(",")})`);

  // ---------- AC23: Today jump button returns to the current week ----------
  const nav23 = page.locator('nav[aria-label="Week navigation"]');
  const jump = page.locator("[data-testid=today-jump]");
  assert(await jump.count() === 1, `AC23 exactly one Today jump (got ${await jump.count()})`);
  assert(await readText(jump) === "Today", `AC23 jump text (got "${await readText(jump)}")`);
  assert(await disabledIfPresent(jump) === true, "AC23 jump is disabled while the current week is shown");
  const navWidth = await ev(nav23, (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  assert(navWidth && navWidth.sw <= navWidth.cw, `AC23 nav fits 390px (got ${JSON.stringify(navWidth)})`);
  await safeClick(page.locator("[data-testid=prev-week]"));
  assert(await waitAnchor(page, "2026-09-07"), "AC23 prev moved off the current week");
  assert(await disabledIfPresent(jump) === false, "AC23 jump is enabled when browsing another week");
  assert(await clickIf(jump), "AC23 jump is clickable");
  assert(await waitAnchor(page, "2026-09-14"), "AC23 jump returns to the current week");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "This week",
    "AC23 heading is This week after the jump");
  assert(await disabledIfPresent(jump) === true, "AC23 jump disables itself again");
  await page.fill("[data-testid=picker]", "2026-09-03");
  await page.dispatchEvent("[data-testid=picker]", "change");
  assert(await waitAnchor(page, "2026-08-31"), "AC23 picker moved to the week of Aug 31");
  assert(await disabledIfPresent(jump) === false, "AC23 jump re-enables after a picker jump");
  assert(await clickIf(jump), "AC23 jump is clickable from a picker window");
  assert(await waitAnchor(page, "2026-09-14"), "AC23 jump returns from the picker window");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "This week",
    "AC23 heading restored after the picker jump");
  assert(await disabledIfPresent(jump) === true, "AC23 jump disabled at the current week again");

  // ================= W13/W14 — scroll-anchor Today on open (Rev 2026-09-27b) =================
  // Anchor triggers only: (1) initial open on the current week; (2) navigation
  // landing on the current week (Today-jump, picker into the current week).
  // Never on poll re-renders, day-file changes, disclosure toggles, or week
  // changes to a past week.
  {
    const V = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 50 });
    const vp = V.page;
    await waitSel(vp, "[data-testid=day-card]");
    assert(await safeVisible(vp.locator("[data-testid=today] [data-testid=active-minutes]")), "W13 setup: Today's detail rendered on load");
    const optimumOf = (g) => (g.offsetTop === null ? null : Math.min(g.offsetTop, g.maxScroll));
    let geo = await todayGeo(vp);
    assert(geo.overflow === true, `W13 setup: the fixture page overflows at 390px (got ${JSON.stringify(geo)})`);
    let want = Math.min(geo.offsetTop, geo.maxScroll);
    assert(geo.scrollY > 0 && Math.abs(geo.scrollY - want) <= 2,
      `W13 initial open anchors the viewport at Today's card (scrollY ${geo.scrollY}, optimum ${want})`);
    assert(geo.bandBottom !== null && geo.bandBottom <= 12,
      `W13 the band scrolled above the viewport top — reachable by scrolling up (bandBottom ${geo.bandBottom})`);
    assert(geo.todayTop >= -2,
      `W13 the anchor never scrolls past Today's top edge (todayTop ${geo.todayTop})`);
    // Past-week navigation does not scroll-jump: the offset is kept within the
    // document's own scroll range (event dispatch, not a real click, so the
    // locator machinery itself does not scroll).
    const anchoredScrollY = geo.scrollY;
    await vp.locator("[data-testid=prev-week]").dispatchEvent("click");
    await waitAnchor(vp, "2026-09-07");
    const pastMax = await vp.evaluate(() => Math.round(document.documentElement.scrollHeight - window.innerHeight));
    const afterPrev = await vp.evaluate(() => Math.round(window.scrollY));
    assert(Math.abs(afterPrev - Math.min(anchoredScrollY, pastMax)) <= 2,
      `W13 opening a past week does not scroll-jump (scrollY ${afterPrev}, kept ${Math.min(anchoredScrollY, pastMax)})`);
    // Returning via Today-jump re-anchors (event dispatch avoids the click scroll).
    assert(await vp.locator("[data-testid=today-jump]").isEnabled(), "W13 setup: Today-jump clickable");
    await vp.locator("[data-testid=today-jump]").dispatchEvent("click");
    await waitAnchor(vp, "2026-09-14");
    geo = await todayGeo(vp);
    want = Math.min(geo.offsetTop, geo.maxScroll);
    assert(geo.scrollY > 0 && Math.abs(geo.scrollY - want) <= 2 && geo.todayTop >= -2,
      `W13 Today-jump re-anchors the viewport at Today's card (scrollY ${geo.scrollY}, optimum ${want}, todayTop ${geo.todayTop})`);
    // Picker: a past-week date is a non-trigger (no jump); a date inside the
    // current week (from a past week) re-anchors. Value set + change event via
    // evaluate: fill() would scroll the picker into view and pollute the scroll
    // comparison. Sep 2026 starts on a Monday, so Sun 13 belongs to the week of
    // Sep 7 and is deliberately avoided.
    const scrollBeforePastPick = geo.scrollY;
    await vp.evaluate(() => {
      const el = document.querySelector("[data-testid=picker]");
      el.value = "2026-09-08";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitAnchor(vp, "2026-09-07");
    const pastMax2 = await vp.evaluate(() => Math.round(document.documentElement.scrollHeight - window.innerHeight));
    const afterPastPick = await vp.evaluate(() => Math.round(window.scrollY));
    assert(Math.abs(afterPastPick - Math.min(scrollBeforePastPick, pastMax2)) <= 2,
      `W13 picker into a past week does not scroll-jump (scrollY ${afterPastPick}, kept ${Math.min(scrollBeforePastPick, pastMax2)})`);
    await vp.evaluate(() => {
      const el = document.querySelector("[data-testid=picker]");
      el.value = "2026-09-16";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitAnchor(vp, "2026-09-14");
    geo = await todayGeo(vp);
    want = Math.min(geo.offsetTop, geo.maxScroll);
    assert(geo.scrollY > 0 && Math.abs(geo.scrollY - want) <= 2 && geo.todayTop >= -2,
      `W13 picker into the current week re-anchors (scrollY ${geo.scrollY}, optimum ${want}, todayTop ${geo.todayTop})`);
    assert(norm(await vp.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "This week",
      "W13 picker into the current week shows the current week");
    assert(geo.bandBottom !== null && geo.bandBottom <= 12,
      `W13 band reachable above the anchor after re-navigation (bandBottom ${geo.bandBottom})`);
    assert((await getAttr(vp.locator("[data-testid=week-band]"), "aria-live")) === null, "W14 a11y baseline: band carries no live region");
    // W14 — anchor discipline: a poll re-render (today file mutated, __pollMs=50)
    // must not move the scroll position.
    await safeClick(cardFor(vp, "2026-09-14").locator("[data-testid=day-summary]"));
    const scrolled = await vp.evaluate(() => { window.scrollTo(0, 180); return Math.round(window.scrollY); });
    assert(scrolled === 180, `W14 setup: the user scroll position (got ${scrolled})`);
    const bumped3 = fixture("2026-09-17");
    bumped3.active_minutes_low = 99;
    bumped3.active_minutes_high = 99;
    overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(bumped3)));
    assert(await waitFn(vp, () => {
      const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
      return el && el.textContent.includes("1h 39m");
    }, null, 5000), "W14 setup: poll re-render with the mutated day file landed");
    const geoAfterPoll = await todayGeo(vp);
    assert(geoAfterPoll.scrollY === scrolled,
      `W14 poll re-render does not move scrollY (before ${scrolled}, after ${geoAfterPoll.scrollY})`);
    assert((await ev(cardFor(vp, "2026-09-14"), (el) => !!el.open)) === true, "W14 opened disclosure survives the poll alongside scroll invariance");
    overrides.delete("/data/2026-09-17.json");
    assert(V.pageerrors.length === 0, `W13/W14 no pageerrors, got ${JSON.stringify(V.pageerrors)}`);
    await vp.close();
  }

  // ---------- W13: a viewport where the whole page fits — anchor is a no-op ----------
  {
    const Z = await openPage({ now: "2026-09-21T13:00:00Z", width: 390, height: 1200 });
    const zp = Z.page;
    await waitSel(zp, "[data-testid=day-card]");
    const fits = await zp.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight);
    assert(fits, "W13 setup: the zero-activity week at a tall viewport fits without overflow");
    const y = await zp.evaluate(() => Math.round(window.scrollY));
    assert(y === 0, `W13 on a page that already fits the viewport the anchor does nothing (scrollY ${y})`);
    assert(Z.pageerrors.length === 0, `W13 no pageerrors on the fits case, got ${JSON.stringify(Z.pageerrors)}`);
    await zp.close();
  }

  // ---------- HTTP cache regression (Pages serves max-age=600) ----------
  const fresh = fixture("2026-09-17");
  fresh.active_minutes_low = 99;
  fresh.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(fresh)));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll("[data-testid=day-card]")];
    const card = cards.find((c) => {
      const title = c.querySelector("[data-testid=day-title]");
      const label = title ? (title.getAttribute("aria-label") || "") : "";
      return label.endsWith("2026-09-17") || (title && title.textContent.trim() === "2026-09-17");
    });
    const el = card && card.querySelector("[data-testid=active-minutes]");
    return !!(el && el.textContent.includes("1h 39m"));
  }, null, { timeout: 5000 }).catch(() => {});
  const reloaded = await readText(cardFor(page, "2026-09-17").locator("[data-testid=active-minutes]"));
  assert(reloaded.includes("1h 39m"), `reload picks up the redeployed day file, not the cached one (got "${reloaded}")`);
  overrides.delete("/data/2026-09-17.json");

  // ---------- coverage expansion: a day with more than one submission badges the count ----------
  const multi = fixture("2026-09-16");
  multi.submissions_and_grades = [
    { item: "Module 2 Quiz", course: "World History EHS", at: "15:48" },
    { item: "Module 3 Quiz", course: "World History EHS", at: "17:37" },
  ];
  // OQ3 bucket-boundary bank (Rev 2026-09-27d): centre (61+74)/2 = 67.5 — the
  // tie rounds UP to the 70-minute bucket ("≈1h 10m"), while centre 67
  // (Today's 60/74 default) rounds DOWN to 65 ("≈1h 05m").
  multi.active_minutes_low = 61;
  multi.active_minutes_high = 74;
  overrides.set("/data/2026-09-16.json", Buffer.from(JSON.stringify(multi)));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  const multiSummary = norm(await cardFor(page, "2026-09-16").locator("[data-testid=day-summary]").textContent().catch(() => ""));
  assert(multiSummary.includes("Wed 16") && multiSummary.includes("≈1h 10m active") && multiSummary.includes("2 quizzes"),
    `OQ3 tie boundary: centre 67.5 rounds up to ≈1h 10m; count badge kept (got "${multiSummary}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 3",
    `band counts every submission (got "${await textIfPresent(page, "[data-testid=week-quizzes]")}")`);
  // OQ3 scope: the expanded detail keeps the exact raw range (honest bounds).
  await safeClick(cardFor(page, "2026-09-16").locator("[data-testid=day-summary]"));
  assert(await readText(cardFor(page, "2026-09-16").locator("[data-testid=active-minutes]")) === "1h 01m–1h 14m",
    `OQ3 the detail keeps the raw 61/74 range (got "${await readText(cardFor(page, "2026-09-16").locator("[data-testid=active-minutes]"))}")`);
  await safeClick(cardFor(page, "2026-09-16").locator("[data-testid=day-summary]"));
  overrides.delete("/data/2026-09-16.json");

  // ---------- Rev 2026-09-27d (W15/OQ2/OQ3) break-restore bank ----------
  // Thursday probe: with an off-boundary centre the band stays raw while
  // collapse lines quantize; the footer/status strings stay exact.
  const thur = fixture("2026-09-16");
  thur.active_minutes_low = 60; // centre 67 → quantize DOWN to 65 (nearest bucket)
  thur.active_minutes_high = 70;
  overrides.set("/data/2026-09-16.json", Buffer.from(JSON.stringify(thur)));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  await waitFn(page, () => {
    const el = document.querySelector("[data-testid=week-active]");
    return el && el.textContent.includes("3h 50m");
  }, null, 5000);
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 50m–4h 42m",
    `OQ3 the band keeps the raw range (230/282 minutes) with quantized day lines (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  const q17 = (await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => (e.textContent || "").replace(/\s+/g, " ")).find((s) => s.includes("Thu 17")))) || "";
  assert(q17.includes("≈1h 05m active"),
    `OQ3 the un-overridden 67-minute centre stays quantized DOWN to ≈1h 05m beside the probe (got "${q17.trim()}")`);
  assert(!(await page.locator("[data-testid=week-active]").getAttribute("aria-label") || "").includes("≈"),
    "OQ3 the band's accessible name stays raw (quantization is collapse-line-only)");
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 4 of 4 days so far",
    `OQ2 the worked line keeps the so-far form with unchanged counts (got "${await textIfPresent(page, "[data-testid=week-worked]")}")`);
  overrides.delete("/data/2026-09-16.json");

  // OQ3 zero guard: a day whose estimate centres on a true zero renders "0m"
  // WITHOUT the ≈ prefix (no false precision on zero).
  const zeroDay = fixture("2026-09-15");
  zeroDay.active_minutes_low = 0;
  zeroDay.active_minutes_high = 0;
  overrides.set("/data/2026-09-15.json", Buffer.from(JSON.stringify(zeroDay)));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  await waitFn(page, () => {
    const el = [...document.querySelectorAll("[data-testid=day-summary]")].find((e) => (e.textContent || "").includes("Tue 15"));
    return el && /0m active/.test(el.textContent) && !el.textContent.includes("≈");
  }, null, 5000);
  const zeroLine = (await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => (e.textContent || "").replace(/\s+/g, " ")).find((s) => s.includes("Tue 15")))) || "";
  assert(zeroLine.includes("0m active") && !zeroLine.includes("≈"),
    `OQ3 a true zero renders 0m without the ≈ prefix (got "${zeroLine.trim()}")`);
  overrides.delete("/data/2026-09-15.json");

  assert(pageerrors.length === 0, `no pageerrors, got ${JSON.stringify(pageerrors)}`);
  await page.close();

  // ================= AC19/W10 page — zero-activity week =================
  const N = await openPage({ now: "2026-09-21T13:00:00Z" });
  const np = N.page;
  const npe = N.pageerrors;
  assert(await waitSel(np, "[data-testid=day-card]"), "AC19 setup: the calendar week renders");
  const t19 = await titles(np);
  assert(t19.join(",") === ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].join(","),
    `AC19 Monday defaults to the current week ascending (got ${t19.join(",")})`);
  assert(norm(await np.locator("[data-testid=week-band] h2").first().textContent().catch(() => "")) === "This week",
    `AC19 current-week heading (got "${norm(await np.locator("[data-testid=week-band] h2").first().textContent().catch(() => ""))}")`);
  // Rev 2026-09-27 (W10): supersedes AC19's zero lines — totals are replaced by
  // the week-empty message; the footer and the 7 day rows still render.
  assert(await textIfPresent(np, "[data-testid=week-empty]") === "No activity logged this week",
    `W10 zero-activity week message (got "${await textIfPresent(np, "[data-testid=week-empty]")}")`);
  assert(await np.locator("[data-testid=week-worked]").count() === 0, "W10 worked line replaced by the message");
  assert(await np.locator("[data-testid=week-active]").count() === 0, "W10 active line replaced by the message");
  assert(await np.locator("[data-testid=week-quizzes]").count() === 0, "W10 quizzes line replaced by the message");
  // Rev 2026-09-27d (W16): on a window with no activity day the footer falls
  // back to the newest imported day across the manifest (descending scan,
  // ≤14 probes) — the em-dash survives only when the whole bounded scan misses.
  assert(await textIfPresent(np, "[data-testid=week-footer]") === "Data last imported 2026-09-17 5:30 PM ET",
    `W16 AC19 empty footer shows the newest imported day's stamp, not the em-dash (got "${await textIfPresent(np, "[data-testid=week-footer]")}")`);
  const today19 = cardFor(np, "2026-09-21");
  assert(/No activity/.test(await readText(today19)),
    `AC19/W10 today (elapsed, no file) keeps the no-activity chip (got "${await readText(today19)}")`);
  assert(await today19.locator("[data-testid=today]").count() === 1, "W10 today stays the single in-list Today layer");
  assert(await today19.locator("[data-testid=day-upcoming]").count() === 0, "AC19 today is not a future marker");
  assert(await np.locator("[data-testid=today]").count() === 1, "W10 exactly one today layer in the zero week");
  for (const date of ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]) {
    const card = cardFor(np, date);
    assert(/Not yet/.test(await readText(card)),
      `Rev 2026-09-27: AC19 future day ${date} shows the Not yet chip (got "${await readText(card)}")`);
    assert(await card.locator("[data-testid=day-future]").count() === 1, `AC19 future day ${date} carries day-future`);
    assert(await card.locator("[data-testid=day-summary]").count() === 0, `AC19 future day ${date} is not expandable`);
  }
  assert(npe.length === 0, `AC19 no pageerrors, got ${JSON.stringify(npe)}`);
  await np.close();

  // ================= W16 — footer global fallback (Rev 2026-09-27d) =================
  // The footer keeps its window scan first (no extra fetches when the window
  // has activity); when the window is quiet it scans the manifest dates
  // descending, bounded at 14 probes, over listed paths only; a bounded-scan
  // miss keeps `Data last imported —`.
  {
    // Leg A — window has activity: the stamp comes from the window scan and
    // ZERO extra day fetches occur (non-window listed dates are never probed).
    const atLegA = new Map(hits); // delta accounting: hits/requests are process-global
    const F16 = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 600000 });
    const f16 = F16.page;
    assert(await waitSel(f16, "[data-testid=today] [data-testid=active-minutes]"), "W16 setup: window with activity renders Today");
    await f16.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    for (const u of hits.keys()) {
      if (/^\/data\/2026-09-(02|03|04|05|06|07|08|09|10|11)\.json$/.test(u) && (hitCount(u) - (atLegA.get(u) || 0)) > 0) {
        assert(false, `W16 window-with-activity fetches no extra day files (got ${hitCount(u) - (atLegA.get(u) || 0)} hit(s) on ${u})`);
      }
    }
    assert(await textIfPresent(f16, "[data-testid=week-footer]") === "Data last imported 2026-09-17 5:30 PM ET",
      `W16 window stamp unchanged when the window has activity (got "${await textIfPresent(f16, "[data-testid=week-footer]")}")`);
    await f16.close();

    // Leg B — bounded scan miss: every manifest-listed day serves an
    // activity-less day file ({"date":"2026-09-17"}-shaped payloads), so the
    // scan probes the 14 listed paths in manifest order, finds nothing, and
    // the footer keeps the em-dash. The request log proves the probe bound
    // (exactly 14 on this fixture), the listed-only rule and the descending
    // order (the break/restore target: a broken ascending scan probes the
    // oldest listed day first and stamps the WRONG day on a partial hit).
    const E16 = await openPage({ now: "2026-09-21T13:00:00Z" });
    const e16 = E16.page;
    assert(await waitSel(e16, "[data-testid=week-empty]"), "W16 setup: the zero-activity window rendered");
    const manifest16 = JSON.parse(fs.readFileSync(path.join(site, "data", "index.json"), "utf8"));
    const dayRefs16 = manifest16.map((ref) => "/" + ref);
    const emptyDay16 = Buffer.from(JSON.stringify({ date: "2026-09-17" }));
    for (const u of dayRefs16) overrides.set(u, emptyDay16);
    const logBefore16 = requests.length;
    await e16.reload({ waitUntil: "load" });
    assert(await waitSel(e16, "[data-testid=week-empty]"), "W16 setup: the zero-activity window rendered after reload");
    // Day-probe filter: ".json" tail match instead of the strict
    // \d{4}-\d{2}-\d{2} shape — today's *absent* (404) live-layer file
    // (2026-09-21, justified, not part of the footer scan) must not count
    // against, or slip past, the footer scan's request-log window.
    const isProbe16 = (r) => /\.json$/.test(r.path) && /\/data\/202[0-9]-/.test(r.path) && r.path !== "/data/index.json";
    assert(await waitNode(() => {
      const probes = requests.slice(logBefore16).filter(isProbe16);
      return probes.length >= dayRefs16.length;
    }, 3000), "W16 setup: the fallback scan's probes are observed in the request log");
    const stamp16 = await textIfPresent(e16, "[data-testid=week-footer]");
    assert(stamp16 === "Data last imported —",
      `W16 em-dash survives when the bounded scan finds no activity day (got "${stamp16}")`);
    const probedPaths16 = requests.slice(logBefore16).filter(isProbe16).map((r) => r.path);
    // The zero week itself (Sep 21–27) fetches its 7 unlisted day paths via
    // the legitimate render/live layer — none are footer-scan probes. The
    // scan's own probe set is the manifest intersection (checked below).
    const zeroWeek16 = new Set(["21", "22", "23", "24", "25", "26", "27"].map((d) => `/data/2026-09-${d}.json`));
    assert(probedPaths16.filter((u) => dayRefs16.includes(u)).length === dayRefs16.length,
      `W16 the fallback probes at most the 14 listed paths on a quiet window (listed paths hit: ${probedPaths16.filter((u) => dayRefs16.includes(u)).length}/14)`);
    const unlisted16 = probedPaths16.filter((u) => !dayRefs16.includes(u) && !zeroWeek16.has(u));
    assert(unlisted16.length === 0,
      `W16 the fallback probes only manifest-listed paths (got ${JSON.stringify(unlisted16)})`);
    assert(probedPaths16.filter((u) => dayRefs16.includes(u)).join(",") === dayRefs16.join(","),
      `W16 the fallback scans manifest dates in descending order (${JSON.stringify(probedPaths16.filter((u) => dayRefs16.includes(u)))})`);
    assert(E16.pageerrors.length === 0, `W16 em-dash case no pageerrors, got ${JSON.stringify(E16.pageerrors)}`);
    for (const u of dayRefs16) overrides.delete(u);
    await e16.close();
  }

  // ================= AC1/AC2/AC11/AC13/AC16/AC10/AC14 page =================
  const T = await openPage({ now: "2026-09-17T20:00:00Z" });
  const tp = T.page;
  const tpe = T.pageerrors;
  assert(await waitSel(tp, "[data-testid=today] [data-testid=active-minutes]"), "AC2 setup: Today's expanded detail renders on load");

  // AC1 (Rev 2026-09-27) — Today lives in its in-list day card, named for the
  // injected current day; the pinned-precedence order is superseded for the
  // current week (see W1 above; W3 below re-tests the pinned strip).
  assert(await tp.locator("[data-testid=today]").count() === 1, "AC1 exactly one Today layer");
  assert(await textIfPresent(tp, "[data-testid=today-date]") === "2026-09-17",
    `AC1 today-date names the injected ET day (got "${await textIfPresent(tp, "[data-testid=today-date]")}")`);

  // AC11 — existing contract and mobile layout unchanged (amended 2026-09-21a).
  const t11 = await titles(tp);
  assert(t11.length === 7 && t11[0] === "2026-09-14" && t11[6] === "2026-09-20",
    `AC11 default window shows 7 calendar-week rows ascending (got ${t11.join(",")})`);
  assert(await tp.locator("[data-testid=week-band]").count() === 1, "AC11 exactly one week band");
  assert(await tp.locator("[data-testid=week-footer]").count() === 1, "AC11 exactly one week footer");
  const todayWidth = await ev(tp.locator("[data-testid=today]"), (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  assert(todayWidth && todayWidth.sw <= todayWidth.cw, `AC11 Today fits 390px (got ${JSON.stringify(todayWidth)})`);
  assert(tpe.length === 0, `AC11 no pageerrors, got ${JSON.stringify(tpe)}`);

  // AC2 — Today's detail is expanded with no interaction, inside its card.
  const todayCard2 = cardFor(tp, "2026-09-17");
  assert(await safeEval(todayCard2, (el) => !!el.open) === true, "W2 the Today card is open by default");
  assert(await todayCard2.locator("[data-testid=day-detail]").count() === 1, "W2 the open card exposes the shared day-detail");
  assert(await safeVisible(todayCard2.locator("[data-testid=active-minutes]")), "AC2 active value visible");
  assert(await readText(todayCard2.locator("[data-testid=active-minutes]")) === "1h 00m–1h 14m",
    `AC2 active value (got "${await readText(todayCard2.locator("[data-testid=active-minutes]"))}")`);
  assert(await readText(todayCard2.locator("[data-testid=quiz-line]")) === "25m",
    `AC2 measured quiz value (got "${await readText(todayCard2.locator("[data-testid=quiz-line]"))}")`);
  assert(await readText(todayCard2.locator("[data-testid=reading-line]")) === "35m–49m",
    `AC2 reading value (got "${await readText(todayCard2.locator("[data-testid=reading-line]"))}")`);
  courses = await todayCard2.locator("[data-testid=course-line]").allTextContents().catch(() => []);
  assert(courses.map(norm).join(" | ") === "Media Arts EHS 1h 00m | World History EHS 10m",
    `AC2 course rows (got ${JSON.stringify(courses)})`);
  assert(await readText(todayCard2.locator("[data-testid=sessions] summary")) === "Sessions (1) · 4:00–5:30 PM",
    `W12 AC2 sessions summary (got "${await readText(todayCard2.locator("[data-testid=sessions] summary"))}")`);
  assert(await safeVisible(todayCard2.locator("[data-testid=submissions]").getByText("Media Arts EHS — Module 1 Quiz · 5:21 PM")),
    "W12 AC2 submission visible inline");
  assert(await tp.locator("[data-testid=first-last]").count() === 0, "AC2 first-last testid removed");

  // AC13 — compact v2 detail; no repeated estimate wording.
  const topCard = cardFor(tp, "2026-09-16");
  await safeClick(topCard.locator("[data-testid=day-summary]"));
  const topDetail = topCard.locator("[data-testid=day-detail]");
  assert(await topDetail.count() === 1, "AC13 card expands into the shared detail");
  const dts = await topDetail.locator("dt").allTextContents().catch(() => []);
  assert(dts.map(norm).join(" | ") === "Active | Quizzes (measured) | Reading",
    `AC13 metric labels are exact (got ${JSON.stringify(dts)})`);
  assert(await readText(topDetail.locator("[data-testid=active-minutes]")) === "58m–1h 12m", "AC13 active value");
  assert(await readText(topDetail.locator("[data-testid=quiz-line]")) === "24m", "AC13 quiz value");
  assert(await readText(topDetail.locator("[data-testid=reading-line]")) === "34m–48m", "AC13 reading value");
  const cardCourses = await topDetail.locator("[data-testid=course-line]").allTextContents().catch(() => []);
  assert(cardCourses.map(norm).join(" | ") === "Media Arts EHS 58m | World History EHS 10m",
    `AC13 exactly two low-estimate course rows (got ${JSON.stringify(cardCourses)})`);
  assert(await readText(topDetail.locator("[data-testid=sessions] summary")) === "Sessions (1) · 4:00–5:30 PM",
    `W12 AC13 sessions summary merges count and span (got "${await readText(topDetail.locator("[data-testid=sessions] summary"))}")`);
  assert(await topDetail.locator("[data-testid=submissions]").count() === 0, "AC13 a no-submission day renders no submissions block");
  const detailText = await readText(topDetail);
  for (const s of ["range", "(estimated)", "about ", "≈"]) {
    assert(!detailText.includes(s), `AC13 detail keeps raw exact values — no "${s}" (got ${JSON.stringify(detailText)})`);
  }
  assert(await tp.locator("[data-testid=legend]").count() === 1, "AC13 exactly one legend");
  assert(await textIfPresent(tp, "[data-testid=legend]") === "Unmarked durations are estimated from page-open gaps; quizzes are measured.",
    `AC13 legend text (got "${await textIfPresent(tp, "[data-testid=legend]")}")`);

  // AC16 — compact detail fits 390px; metric values are tabular.
  const detailWidths = await tp.$$eval("[data-testid=day-detail]:visible", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(detailWidths.length === 2 && detailWidths.every((w) => w.sw <= w.cw),
    `AC16 Today + expanded card details fit 390px (got ${JSON.stringify(detailWidths)})`);
  const fvn = await tp.$$eval(
    "[data-testid=day-detail]:visible [data-testid=active-minutes], [data-testid=day-detail]:visible [data-testid=quiz-line], [data-testid=day-detail]:visible [data-testid=reading-line]",
    (els) => els.map((e) => getComputedStyle(e).fontVariantNumeric));
  assert(fvn.length === 6 && fvn.every((v) => v === "tabular-nums"),
    `AC16 metric values compute tabular-nums (got ${JSON.stringify(fvn)})`);

  // AC10/W3 — pinned strip when browsing away.
  await safeClick(tp.locator("[data-testid=prev-week]"));
  assert(await waitAnchor(tp, "2026-09-07"), "AC10 prev moved to the previous calendar week");
  await tp.fill("[data-testid=picker]", "2026-09-03");
  await tp.dispatchEvent("[data-testid=picker]", "change");
  assert(await waitAnchor(tp, "2026-08-31"), "AC10 picker moved to the mapped week");
  assert(await textIfPresent(tp, "[data-testid=today-date]") === "2026-09-17", "AC10 Today stays pinned across week navigation");
  assert(await safeVisible(tp.locator("[data-testid=today] [data-testid=active-minutes]")), "AC10 Today detail still visible after navigation");
  const w3Order = await ev(tp.locator("[data-testid=today]"), (el) => {
    const band = document.querySelector("[data-testid=week-band]");
    const inCard = !!el.closest("[data-testid=day-card]");
    const heading = el.querySelector("h2");
    return {
      precedesBand: !!(band && (el.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING)),
      inCard,
      heading: heading ? heading.textContent.replace(/\s+/g, " ").trim() : "",
    };
  });
  assert(w3Order && w3Order.precedesBand === true, "W3 the pinned Today strip precedes the week band when browsing away");
  assert(w3Order && w3Order.inCard === false, "W3 the pinned strip is not inside a day card");
  assert(w3Order && w3Order.heading === "Today · Sep 17", `W3 pinned strip heading (got "${w3Order && w3Order.heading}")`);
  // W15 (Rev 2026-09-27c): the pinned strip's status line uses the same
  // last-checked wording as the in-list card.
  assert(await textIfPresent(tp, "[data-testid=today] [data-testid=today-status]") === "Data last checked Sep 17, 4:10 PM ET",
    `W15 pinned strip keeps the last-checked retrieval line (got "${await textIfPresent(tp, "[data-testid=today] [data-testid=today-status]")}")`);
  assert(await tp.locator("[data-testid=day-card] [data-testid=day-today]").count() === 0, "W3 browsed window carries no Today marker");

  // AC14 — v1 detail stays honest.
  const v1p = cardFor(tp, "2026-09-03");
  await safeClick(v1p.locator("[data-testid=day-summary]"));
  const v1d = v1p.locator("[data-testid=day-detail]");
  assert(await readText(v1d.locator("[data-testid=active-minutes]")) === "42m", "AC14 v1 active is a single value");
  assert(await v1d.locator("[data-testid=quiz-line]").count() === 0, "AC14 v1 has no quiz row");
  assert(await v1d.locator("[data-testid=reading-line]").count() === 0, "AC14 v1 has no reading row");
  assert(await readText(v1d.locator("[data-testid=course-line]").first()) === "Media Arts EHS 42m",
    "AC14 v1 course row uses estimated_minutes");
  assert(await safeVisible(v1d.locator("[data-testid=v1-note]")), "AC14 v1 note visible");
  assert(await readText(v1d.locator("[data-testid=v1-note]")) === "estimated from session span", "AC14 v1 note text");
  // AC14's "no – range" is scoped to the metric duration values: the sessions
  // summary legitimately carries a time en-dash (4:00–5:30 PM) per the plan.
  const v1metrics = await v1d.locator("dl.metrics dd").allTextContents().catch(() => []);
  assert(v1metrics.length > 0 && !v1metrics.some((x) => x.includes("–")),
    `AC14 v1 metric values invent no durational range (got ${JSON.stringify(v1metrics)})`);
  await safeClick(v1p.locator("[data-testid=day-summary]"));
  await tp.close();

  // ================= AC3 page — literal ET calendar day =================
  const D = await openPage({ now: "2026-09-17T03:59:00Z" });
  const dp = D.page;
  await waitSel(dp, "[data-testid=today-date]");
  assert(await textIfPresent(dp, "[data-testid=today-date]") === "2026-09-16",
    `AC3 03:59Z is 23:59 ET on the prior day (got "${await textIfPresent(dp, "[data-testid=today-date]")}")`);
  await dp.addInitScript(() => { window.__now = "2026-09-17T04:01:00Z"; });
  await dp.reload({ waitUntil: "load" });
  await waitSel(dp, "[data-testid=today-date]");
  assert(await textIfPresent(dp, "[data-testid=today-date]") === "2026-09-17",
    `AC3 04:01Z is 00:01 ET on the new day (got "${await textIfPresent(dp, "[data-testid=today-date]")}")`);
  await dp.addInitScript(() => { window.__now = "2026-12-15T04:30:00Z"; });
  await dp.reload({ waitUntil: "load" });
  await waitSel(dp, "[data-testid=today-date]");
  assert(await textIfPresent(dp, "[data-testid=today-date]") === "2026-12-14",
    `AC3 winter EST offset honored (got "${await textIfPresent(dp, "[data-testid=today-date]")}")`);
  await dp.close();

  // ================= AC4 page — no file yet for today =================
  const E = await openPage({ now: "2026-09-18T12:00:00Z" });
  const ep = E.page;
  const epe = E.pageerrors;
  assert(await waitSel(ep, "[data-testid=today-empty]"), "AC4 empty state renders without error");
  assert(await safeVisible(ep.locator("[data-testid=today-empty]")), "AC4 today-empty is visible");
  // W15: the empty-day state keeps its retrieval-time-based status line — now
  // with the last-checked wording.
  assert(await textIfPresent(ep, "[data-testid=today-status]") === "Data last checked Sep 17, 4:10 PM ET",
    `W15 empty-day keeps the last-checked retrieval line (got "${await textIfPresent(ep, "[data-testid=today-status]")}")`);
  assert(await ep.locator("[data-testid=today] [data-testid=active-minutes]").count() === 0, "AC4 no active value in the empty state");
  assert(epe.length === 0, `AC4 no pageerrors, got ${JSON.stringify(epe)}`);
  await ep.close();

  // ================= AC5 page — today's file appears mid-session via polling =================
  const F = await openPage({ now: "2026-09-18T12:00:00Z", pollMs: 50 });
  const fp = F.page;
  await waitSel(fp, "[data-testid=today-empty]");
  const manifest = JSON.parse(fs.readFileSync(path.join(site, "data", "index.json"), "utf8"));
  overrides.set("/data/index.json", Buffer.from(JSON.stringify(["data/2026-09-18.json"].concat(manifest))));
  const synth = fixture("2026-09-17");
  synth.date = "2026-09-18";
  overrides.set("/data/2026-09-18.json", Buffer.from(JSON.stringify(synth)));
  assert(await waitFn(fp, () => {
    const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
    return el && el.textContent.replace(/\s+/g, " ").trim() === "1h 00m–1h 14m";
  }, null, 5000), "AC5 poll picks up today's file appearing mid-session");
  assert(await fp.locator("[data-testid=today] [data-testid=today-empty]").count() === 0, "AC5 empty state is replaced");
  overrides.delete("/data/index.json");
  overrides.delete("/data/2026-09-18.json");
  await fp.close();

  // ================= AC6 page — in-place poll update; open disclosure survives =================
  const G = await openPage({ now: "2026-09-17T20:42:00Z", pollMs: 50 });
  const gp = G.page;
  const gpe = G.pageerrors;
  await waitSel(gp, "[data-testid=today] [data-testid=active-minutes]");
  const openCard = cardFor(gp, "2026-09-15");
  await safeClick(openCard.locator("[data-testid=day-summary]"));
  await gp.evaluate(() => { window.__marker = 1; });
  const bumped = fixture("2026-09-17");
  bumped.active_minutes_low = 99;
  bumped.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(bumped)));
  assert(await waitFn(gp, () => {
    const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
    return el && el.textContent.includes("1h 39m");
  }, null, 5000), "AC6 poll updates the Today detail in place");
  assert(await readText(gp.locator("[data-testid=today] [data-testid=active-minutes]")) === "1h 39m", "AC6 new active value");
  assert(await textIfPresent(gp, "[data-testid=today-status]") === "Data last checked Sep 17, 4:10 PM ET",
    `AC6 status shows the pipeline retrieval time, never the page clock (got "${await textIfPresent(gp, "[data-testid=today-status]")}")`);
  assert(await gp.evaluate(() => window.__marker) === 1, "AC6 no reload happened");
  assert(await safeVisible(openCard.locator("[data-testid=active-minutes]")), "AC6 open day disclosure survives the render");
  assert(await safeEval(cardFor(gp, "2026-09-17"), (el) => !!el.open) === true, "W2 the in-list Today card's open state persists across polls");
  assert(gpe.length === 0, `AC6 no pageerrors, got ${JSON.stringify(gpe)}`);
  overrides.delete("/data/2026-09-17.json");
  await gp.close();

  // ================= AC7 page — fetch failure keeps last-good data and recovers =================
  const H = await openPage({ now: "2026-09-17T20:42:00Z", pollMs: 50 });
  const hp = H.page;
  const hpe = H.pageerrors;
  await waitSel(hp, "[data-testid=today] [data-testid=active-minutes]");
  const lastGood = await readText(hp.locator("[data-testid=today] [data-testid=active-minutes]"));
  overrides.set("/data/2026-09-17.json", Buffer.from("not json {"));
  assert(await waitFn(hp, () => {
    const el = document.querySelector("[data-testid=today-status]");
    return el && el.textContent.trim() === "Showing last loaded data";
  }, null, 5000), "AC7 fetch failure degrades to last-loaded status");
  const failHits = hitCount("/data/2026-09-17.json");
  assert(await waitNode(() => hitCount("/data/2026-09-17.json") - failHits >= 2, 5000), "AC7 setup: two further failing poll cycles observed");
  assert(await readText(hp.locator("[data-testid=today] [data-testid=active-minutes]")) === lastGood, "AC7 last-good detail retained");
  assert(hpe.length === 0, `AC7 no pageerrors, got ${JSON.stringify(hpe)}`);
  overrides.delete("/data/2026-09-17.json");
  assert(await waitFn(hp, () => {
    const el = document.querySelector("[data-testid=today-status]");
    return el && el.textContent.replace(/\s+/g, " ").trim() === "Data last checked Sep 17, 4:10 PM ET";
  }, null, 5000), "AC7 recovers to the retrieval line after the failure clears");
  assert(await readText(hp.locator("[data-testid=today] [data-testid=active-minutes]")) === lastGood, "AC7 detail correct after recovery");
  await hp.close();

  // ================= AC8 page — Refresh button forces an immediate fetch =================
  const I = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 60000 });
  const ip = I.page;
  await waitSel(ip, "[data-testid=today] [data-testid=active-minutes]");
  const forced = fixture("2026-09-17");
  forced.active_minutes_low = 99;
  forced.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(forced)));
  assert(await clickIf(ip.locator("[data-testid=today-refresh]")), "AC8 Refresh button present");
  assert(await waitFn(ip, () => {
    const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
    return el && el.textContent.includes("1h 39m");
  }, null, 5000), "AC8 Refresh forces an immediate fetch");
  assert(await textIfPresent(ip, "[data-testid=today-status]") === "Data last checked Sep 17, 4:10 PM ET",
    `AC8 status ends on the retrieval line (got "${await textIfPresent(ip, "[data-testid=today-status]")}")`);
  overrides.delete("/data/2026-09-17.json");
  await ip.close();

  // ================= AC9 page — background polling pauses while hidden =================
  const J = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 100 });
  const jp = J.page;
  await waitSel(jp, "[data-testid=today] [data-testid=active-minutes]");
  const dayPath = "/data/2026-09-17.json";
  const hitsAtLoad = hitCount(dayPath);
  assert(await waitNode(() => hitCount(dayPath) > hitsAtLoad, 3000), "AC9 page polls while visible");
  await jp.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await jp.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {}); // settle any in-flight fetch
  const hiddenStart = hitCount(dayPath);
  const tickedWhileHidden = await waitNode(() => hitCount(dayPath) > hiddenStart, 400); // spans ~4 intervals at 100ms
  assert(!tickedWhileHidden, `AC9 polling pauses while hidden (start ${hiddenStart}, end ${hitCount(dayPath)})`);
  await jp.evaluate(() => { window.__pollMs = 5000; });
  await jp.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(await waitNode(() => hitCount(dayPath) > hiddenStart, 1000),
    "AC9 resume refreshes immediately (well before the 5s interval)");
  await jp.close();

  // ================= AC12 page — no endpoint surface =================
  const K = await newPage({ now: "2026-09-17T20:00:00Z", pollMs: 50 });
  const kp = K.page;
  const kpe = K.pageerrors;
  const logStart = requests.length;
  await kp.goto("http://localhost:8931/", { waitUntil: "load" });
  await waitSel(kp, "[data-testid=today] [data-testid=active-minutes]");
  const dayHits12 = hitCount(dayPath);
  assert(await waitNode(() => hitCount(dayPath) - dayHits12 >= 2, 5000), "AC12 setup: two poll cycles observed");
  const log = requests.slice(logStart);
  const bad = log.filter((r) => r.method !== "GET" || !(r.path === "/" || r.path.startsWith("/data/")));
  assert(log.length > 0, "AC12 request log is non-empty");
  assert(bad.length === 0, `AC12 only same-origin GET / and /data/ requests (got ${JSON.stringify(bad)})`);
  assert(kpe.length === 0, `AC12 no pageerrors, got ${JSON.stringify(kpe)}`);
  await kp.close();

  // ================= AC17 page — retrieval time comes from the pipeline, not the page clock =================
  const U = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 100 });
  const up = U.page;
  const upe = U.pageerrors;
  const RETRIEVED = "Data last checked Sep 17, 4:10 PM ET";
  assert(await waitSel(up, "[data-testid=today] [data-testid=active-minutes]"), "AC17 setup: Today's detail renders on load");
  assert(await textIfPresent(up, "[data-testid=today-status]") === RETRIEVED,
    `AC17 status reads the fixture retrieval line on load (got "${await textIfPresent(up, "[data-testid=today-status]")}")`);
  const statusHits = hitCount("/data/status.json");
  assert(await waitNode(() => hitCount("/data/status.json") > statusHits, 3000), "AC17 setup: a poll cycle re-fetched status.json");
  assert(await textIfPresent(up, "[data-testid=today-status]") === RETRIEVED,
    `AC17 retrieval line survives a poll (got "${await textIfPresent(up, "[data-testid=today-status]")}")`);
  const retrDay = fixture("2026-09-17");
  retrDay.active_minutes_low = 99;
  retrDay.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(retrDay)));
  assert(await clickIf(up.locator("[data-testid=today-refresh]")), "AC17 Refresh present (day-only change)");
  assert(await waitFn(up, () => {
    const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
    return el && el.textContent.includes("1h 39m");
  }, null, 5000), "AC17 setup: the day-file change landed");
  assert(await textIfPresent(up, "[data-testid=today-status]") === RETRIEVED,
    `AC17 a day-only change leaves the retrieval line unchanged (got "${await textIfPresent(up, "[data-testid=today-status]")}")`);
  overrides.delete("/data/2026-09-17.json");
  overrides.set("/data/status.json", Buffer.from(JSON.stringify({ fetched_at: "2026-09-17T21:45:00Z" })));
  assert(await clickIf(up.locator("[data-testid=today-refresh]")), "AC17 Refresh present (status override)");
  assert(await waitFn(up, () => {
    const el = document.querySelector("[data-testid=today-status]");
    return el && el.textContent.replace(/\s+/g, " ").trim() === "Data last checked Sep 17, 5:45 PM ET";
  }, null, 5000), "AC17 manual refresh surfaces the new pipeline retrieval time");
  overrides.set("/data/status.json", Buffer.from("not json {"));
  assert(await clickIf(up.locator("[data-testid=today-refresh]")), "AC17 Refresh present (invalid status)");
  assert(await waitFn(up, () => {
    const el = document.querySelector("[data-testid=today-status]");
    return el && el.textContent.trim() === "Retrieval time unavailable";
  }, null, 5000), "AC17 invalid status.json reads Retrieval time unavailable");
  overrides.delete("/data/status.json");
  assert(upe.length === 0, `AC17 no pageerrors, got ${JSON.stringify(upe)}`);
  await up.close();

  // ================= coverage-gate expansion: ET-midnight rollover =================
  // Guards review fix 1 (never probe an unlisted day file) + fix 2 (today keyed to
  // its ET date): crossing ET midnight mid-session must drop yesterday's detail.
  const R = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 50 });
  const rp = R.page;
  assert(await waitSel(rp, "[data-testid=today] [data-testid=active-minutes]"), "rollover setup: today's detail loaded");
  await rp.evaluate(() => { window.__now = "2026-09-18T12:00:00Z"; });
  assert(await waitFn(rp, () => {
    const el = document.querySelector("[data-testid=today-date]");
    return el && el.textContent.trim() === "2026-09-18";
  }, null, 5000), "rollover: poll moves Today to the new ET calendar day");
  assert(await waitSel(rp, "[data-testid=today-empty]"), "rollover: new day with no capture renders the empty state");
  assert(await rp.locator("[data-testid=today] [data-testid=active-minutes]").count() === 0, "rollover: yesterday's detail is cleared");
  await rp.close();

  // ================= coverage-gate expansion: unchanged polls do not re-render =================
  // Guards review fix 3 (content-diff skip): an unchanged poll updates the
  // aria-live status in place and keeps the Today DOM nodes connected.
  const S = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 50 });
  const sp = S.page;
  assert(await waitSel(sp, "[data-testid=today] [data-testid=active-minutes]"), "stable-poll setup: today's detail loaded");
  await sp.evaluate(() => {
    window.__todayNode = document.querySelector("[data-testid=today]");
    window.__statusNode = document.querySelector("[data-testid=today-status]");
  });
  const stableHits = hitCount("/data/2026-09-17.json");
  assert(await waitNode(() => hitCount("/data/2026-09-17.json") - stableHits >= 2, 5000), "stable-poll setup: two unchanged polls observed");
  assert(await sp.evaluate(() => !!(window.__todayNode && window.__todayNode.isConnected)), "unchanged polls keep the Today DOM node (no re-render)");
  assert(await sp.evaluate(() => window.__statusNode === document.querySelector("[data-testid=today-status]")), "unchanged polls reuse the aria-live status node");
  await sp.close();

  // ================= W7/W8/W9/W12 desktop page (1280x800) — Rev 2026-09-27 =================
  const P = await openPage({ now: "2026-09-17T20:00:00Z", width: 1280, height: 800 });
  const pp = P.page;
  const ppe = P.pageerrors;
  assert(await waitSel(pp, "[data-testid=day-card]"), "W7 setup: the week renders at desktop");

  // W7: 7-track CSS grid, ascending, inline expansion grows only its column.
  const grid = await pp.$eval("#days", (el) => {
    const cs = getComputedStyle(el);
    return { display: cs.display, cols: cs.gridTemplateColumns.split(" ").filter(Boolean).length };
  });
  assert(grid.display === "grid", `W7 day list computes display:grid at 1280px (got "${grid.display}")`);
  assert(grid.cols === 7, `W7 exactly 7 grid tracks (got ${grid.cols})`);
  const alignStart = await pp.$eval("#days", (el) => getComputedStyle(el).alignItems);
  assert(alignStart === "start", `W7 align-items:start (got "${alignStart}")`);
  const bodyMax = await pp.$eval("body", (el) => getComputedStyle(el).maxWidth);
  assert(bodyMax === "1200px", `W7 body max-width 1200px (got "${bodyMax}")`);
  const headerRow = await pp.$eval("body", (el) => {
    const h1 = el.querySelector("h1");
    const navEl = el.querySelector('nav[aria-label="Week navigation"]');
    if (!h1 || !navEl) return null;
    return Math.abs(h1.getBoundingClientRect().top - navEl.getBoundingClientRect().top) < 40;
  });
  assert(headerRow === true, "W7 header title and nav share one row at desktop");
  const dTitles = await titles(pp);
  assert(dTitles.join(",") === ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].join(","),
    `W7 DOM order stays ascending at desktop (got ${dTitles.join(",")})`);
  const xsBefore = await pp.$$eval("[data-testid=day-card]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  const expandCard = cardFor(pp, "2026-09-15");
  await safeClick(expandCard.locator("[data-testid=day-summary]"));
  const xsAfter = await pp.$$eval("[data-testid=day-card]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  assert(JSON.stringify(xsBefore) === JSON.stringify(xsAfter),
    `W7 expanding one column leaves every sibling x unchanged (before ${JSON.stringify(xsBefore)}, after ${JSON.stringify(xsAfter)})`);
  const grew = await safeEval(expandCard, (el) => el.getBoundingClientRect().height > 120);
  assert(grew === true, "W7 the expanded column grows downward");
  const innerScroll = await safeEval(expandCard, (el) =>
    [...el.querySelectorAll("[data-testid=day-detail] *")].filter((n) => n.scrollHeight > n.clientHeight + 1).length);
  assert(innerScroll === 0, `W7 no expanded detail element scrolls internally (got ${innerScroll})`);
  const desktopOverflow = await pp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert(desktopOverflow === true, "W7 no horizontal overflow at 1280px");

  // W9: band not live; touch minimums at desktop.
  assert((await getAttr(pp.locator("[data-testid=week-band]"), "aria-live")) === null, "W9 no aria-live on the band at desktop");
  const summaryHeightsD = await pp.$$eval("[data-testid=day-summary]", (els) => els.map((e) => e.getBoundingClientRect().height));
  assert(summaryHeightsD.length === 4 && summaryHeightsD.every((h) => h >= 44),
    `W9 desktop summaries are at least 44px tall (got ${JSON.stringify(summaryHeightsD)})`);

  // W12: exact 12-hour strings + absence scan for raw 24-hour times.
  const todayCardD = cardFor(pp, "2026-09-17");
  assert(await readText(todayCardD.locator("[data-testid=sessions] summary")) === "Sessions (1) · 4:00–5:30 PM",
    `W12 desktop sessions summary (got "${await readText(todayCardD.locator("[data-testid=sessions] summary"))}")`);
  assert(await safeVisible(todayCardD.getByText("Module 1 Quiz · 5:21 PM")), "W12 desktop submission time");
  assert(await textIfPresent(pp, "[data-testid=week-footer]") === "Data last imported 2026-09-17 5:30 PM ET",
    `W15 desktop footer (got "${await textIfPresent(pp, "[data-testid=week-footer]")}")`);
  const sessionsD = todayCardD.locator("[data-testid=sessions]");
  await safeClick(sessionsD.locator("summary"));
  const bodyText = await pp.evaluate(() => document.body.innerText);
  for (const s of ["16:00", "17:30", "17:21"]) {
    assert(!bodyText.includes(s), `W12 raw 24-hour string ${s} appears nowhere in rendered text`);
  }
  assert(bodyText.includes("4:10 PM"), "W12 the retrieval line stays 12-hour");
  await safeClick(sessionsD.locator("summary"));

  // W8: pure-CSS reflow — one instance resized 1280→390→1280.
  await safeClick(expandCard.locator("[data-testid=day-summary]")); // collapse again
  await safeClick(cardFor(pp, "2026-09-16").locator("[data-testid=day-summary]")); // open one disclosure
  await pp.setViewportSize({ width: 390, height: 844 });
  const midOrder = await titles(pp);
  assert(midOrder.join(",") === dTitles.join(","), `W8 ascending order survives the resize to 390 (got ${midOrder.join(",")})`);
  assert(await safeEval(cardFor(pp, "2026-09-16"), (el) => !!el.open) === true, "W8 opened disclosure survives the resize");
  const midGrid = await pp.$eval("#days", (el) => getComputedStyle(el).display);
  assert(midGrid !== "grid", `W8 single column below 1080px (got "${midGrid}")`);
  const midOverflow = await pp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert(midOverflow === true, "W8 no horizontal overflow after resizing to 390");
  await pp.setViewportSize({ width: 1280, height: 800 });
  const backOrder = await titles(pp);
  assert(backOrder.join(",") === dTitles.join(","), `W8 ascending order survives the resize back (got ${backOrder.join(",")})`);
  assert(await safeEval(cardFor(pp, "2026-09-16"), (el) => !!el.open) === true, "W8 disclosure still open after the round trip");
  const backGrid = await pp.$eval("#days", (el) => getComputedStyle(el).display);
  assert(backGrid === "grid", `W8 grid returns above the breakpoint (got "${backGrid}")`);
  assert(ppe.length === 0, `W8 no pageerrors across the resize sequence, got ${JSON.stringify(ppe)}`);
  await pp.close();

  // ================= W8 focus/scroll survival + W9 mobile — Rev 2026-09-27 =================
  const Q = await openPage({ now: "2026-09-17T20:00:00Z", pollMs: 50 });
  const qp = Q.page;
  const qpe = Q.pageerrors;
  assert(await waitSel(qp, "[data-testid=today] [data-testid=active-minutes]"), "W8 setup: today's detail loaded");
  // Make the document taller than the viewport so scroll preservation is testable.
  for (const d of ["2026-09-14", "2026-09-15"]) {
    await safeClick(cardFor(qp, d).locator("[data-testid=day-summary]"));
  }
  await qp.evaluate(() => window.scrollTo(0, 300));
  const scrollBefore = await qp.evaluate(() => window.scrollY);
  assert(scrollBefore > 0, `W8 setup: the page is scrolled (scrollY ${scrollBefore})`);
  try { await cardFor(qp, "2026-09-16").locator("[data-testid=day-summary]").focus({ timeout: 1000 }); } catch {}
  const bumped2 = fixture("2026-09-17");
  bumped2.active_minutes_low = 99;
  bumped2.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(bumped2)));
  assert(await waitFn(qp, () => {
    const el = document.querySelector("[data-testid=today] [data-testid=active-minutes]");
    return el && el.textContent.includes("1h 39m");
  }, null, 5000), "W8 setup: the poll re-render landed");
  const focusAfter = await qp.evaluate(() => {
    const ae = document.activeElement;
    const card = ae && ae.closest ? ae.closest("[data-testid=day-card]") : null;
    const title = card && card.querySelector("[data-testid=day-title]");
    return { tag: ae ? ae.tagName : "", date: title ? (title.getAttribute("aria-label") || "").split(", ").pop() : "" };
  });
  assert(focusAfter && focusAfter.tag === "SUMMARY" && focusAfter.date === "2026-09-16",
    `W8 focus stays on the same day's summary across the poll re-render (got ${JSON.stringify(focusAfter)})`);
  const scrollAfter = await qp.evaluate(() => window.scrollY);
  assert(scrollAfter === scrollBefore, `W8 scroll position unchanged across the re-render (before ${scrollBefore}, after ${scrollAfter})`);
  overrides.delete("/data/2026-09-17.json");
  const summaryHeightsM = await qp.$$eval("[data-testid=day-summary]", (els) => els.map((e) => e.getBoundingClientRect().height));
  assert(summaryHeightsM.length >= 1 && summaryHeightsM.every((h) => h >= 44),
    `W9 mobile summaries are at least 44px tall (got ${JSON.stringify(summaryHeightsM)})`);
  const controlHeights = await qp.$$eval('nav[aria-label="Week navigation"] button, [data-testid=today-refresh]', (els) => els.map((e) => e.getBoundingClientRect().height));
  assert(controlHeights.length >= 4 && controlHeights.every((h) => h >= 24),
    `W9 nav buttons and refresh are at least 24px (got ${JSON.stringify(controlHeights)})`);
  assert((await getAttr(qp.locator("[data-testid=today-status]"), "aria-live")) === "polite", "W9 today-status keeps aria-live=polite");
  assert(qpe.length === 0, `W8/W9 no pageerrors, got ${JSON.stringify(qpe)}`);
  await qp.close();

  // ================= W6 narrow 700px — Rev 2026-09-27 =================
  const W = await openPage({ now: "2026-09-17T20:00:00Z", width: 700, height: 900 });
  const wp = W.page;
  const wpe = W.pageerrors;
  assert(await waitSel(wp, "[data-testid=day-card]"), "W6 setup: the week renders at 700px");
  const overflow700 = await wp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert(overflow700 === true, "W6 no horizontal page overflow at 700px");
  const rowOverflow700 = await wp.$$eval("[data-testid=day-card]", (els) => els.every((e) => e.scrollWidth <= e.clientWidth));
  assert(rowOverflow700 === true, "W6 no day row overflows at 700px");
  const singleCol700 = await wp.$eval("#days", (el) => getComputedStyle(el).display);
  assert(singleCol700 !== "grid", `W6 single column at 700px (got "${singleCol700}")`);
  assert(wpe.length === 0, `W6 no pageerrors at 700px, got ${JSON.stringify(wpe)}`);
  await wp.close();

  await browser.close();
  server.close();
  console.log(failures ? "page.spec.js FAILED" : "page.spec.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
