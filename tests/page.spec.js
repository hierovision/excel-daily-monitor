// U1-U8 + AC1-AC22 — at-a-glance calendar-week band, collapsible day cards, the
// live `Today` section, the compact day detail (2026-09-20b), the pipeline
// retrieval time (2026-09-20c), and the Monday-start calendar week (2026-09-21a).
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
  const newPage = async ({ now, pollMs } = {}) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
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
  const ev = async (locator, fn) => {
    try { if (await locator.count() === 0) return null; return await locator.first().evaluate(fn); } catch { return null; }
  };
  const snap = async (locator) => {
    try { if (await locator.count() === 0) return ""; return await locator.first().ariaSnapshot(); } catch { return ""; }
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
  const titles = (page) => page.$$eval("[data-testid=day-title]", (els) => els.map((e) => e.textContent.trim()));
  const cardFor = (page, date) => page.locator("[data-testid=day-card]", { has: page.locator("[data-testid=day-title]", { hasText: date }) }).first();
  const waitAnchor = (page, date) => waitFn(page, (d) => {
    const el = document.querySelector("[data-testid=day-title]");
    return el && el.textContent.trim() === d;
  }, date, 5000);
  const fixture = (date) => JSON.parse(fs.readFileSync(path.join(site, "data", `${date}.json`), "utf8"));

  // ================= legacy U1-U8 page (pinned to the fixture week) =================
  const A = await openPage({ now: "2026-09-17T20:00:00Z" });
  const page = A.page;
  const pageerrors = A.pageerrors;
  await page.waitForSelector("[data-testid=day-card]");

  // ---------- U2/AC20 (setup): 7 day rows, calendar week ascending ----------
  let t = await titles(page);
  assert(t.length === 7, `default window shows 7 day rows (got ${t.length})`);
  assert(t.join(",") === ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"].join(","),
    `AC20 default window is the current calendar week ascending (got ${t.join(",")})`);

  // ---------- U1/AC20: week band (current calendar week, compact range format) ----------
  assert(await page.locator("[data-testid=week-band]").count() === 1, "exactly one week band");
  assert((await page.locator("[data-testid=week-band]").getAttribute("aria-live")) === "polite", "week band is aria-live=polite");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    `AC20 current-week heading is This week (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent())}")`);
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 4 of 7 days",
    `AC20 default band worked line (got "${await textIfPresent(page, "[data-testid=week-worked]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 48m–4h 44m",
    `AC20 default band active line is the calendar-week total (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 1",
    `AC20 default band quizzes line (got "${await textIfPresent(page, "[data-testid=week-quizzes]")}")`);
  const weekSubs = page.locator("[data-testid=week-band] details");
  assert(norm(await weekSubs.locator("summary").textContent()) === "Show submissions", "band submissions behind a disclosure");
  await weekSubs.locator("summary").click();
  assert(await weekSubs.getByText("Submitted: Module 1 Quiz — Media Arts EHS").isVisible(), "band submission item visible when opened");
  await weekSubs.locator("summary").click();

  // ---------- U2: collapsed day lines + AC20 future markers ----------
  assert(await page.locator("[data-testid=day-summary]").count() === 4, `only active days are expandable (got ${await page.locator("[data-testid=day-summary]").count()} summaries)`);
  const top = cardFor(page, "2026-09-17");
  assert(norm(await top.locator("[data-testid=day-summary]").textContent()) === "2026-09-17 about 1h 07m active Quiz submitted",
    `collapsed top line (got "${norm(await top.locator("[data-testid=day-summary]").textContent())}")`);
  assert(norm(await cardFor(page, "2026-09-16").locator("[data-testid=day-summary]").textContent()) === "2026-09-16 about 1h 05m active",
    "collapsed line has a quiz badge only when submissions exist");
  for (const sel of ["active-minutes", "quiz-line", "reading-line", "courses", "sessions", "submissions"]) {
    assert(await top.locator(`[data-testid=${sel}]`).isHidden(), `detail ${sel} hidden before expansion`);
  }
  assert(await page.locator("[data-testid=first-last]").count() === 0, "first-last testid is gone");
  for (const date of ["2026-09-18", "2026-09-19", "2026-09-20"]) {
    const card = cardFor(page, date);
    assert(await readText(card) === `${date} —`,
      `AC20 future day ${date} renders the muted marker (got "${await readText(card)}")`);
    assert(await card.locator("[data-testid=day-upcoming]").count() === 1, `AC20 future day ${date} carries day-upcoming`);
    assert(await card.locator("[data-testid=day-summary]").count() === 0, `future day ${date} is not expandable`);
    assert(!/no activity/.test(await readText(card)), `future day ${date} is not no-activity`);
  }

  // ---------- U3: progressive disclosure on the top day (compact strings) ----------
  await top.locator("[data-testid=day-summary]").click();
  assert(await top.locator("[data-testid=day-detail]").count() === 1, "expanded card exposes the shared day-detail wrapper");
  assert(await top.locator("[data-testid=active-minutes]").isVisible(), "active line visible after expansion");
  assert(await readText(top.locator("[data-testid=active-minutes]")) === "1h 00m–1h 14m",
    `active detail value (got "${await readText(top.locator("[data-testid=active-minutes]"))}")`);
  assert(await readText(top.locator("[data-testid=quiz-line]")) === "25m",
    `measured quiz detail value (got "${await readText(top.locator("[data-testid=quiz-line]"))}")`);
  assert(await readText(top.locator("[data-testid=reading-line]")) === "35m–49m",
    `reading detail value (got "${await readText(top.locator("[data-testid=reading-line]"))}")`);
  const courses = await top.locator("[data-testid=course-line]").allTextContents();
  assert(courses.map(norm).join(" | ") === "Media Arts EHS 1h 00m | World History EHS 10m",
    `course lines use the low estimate without an "active" suffix (got ${JSON.stringify(courses)})`);
  const sessions = top.locator("[data-testid=sessions]");
  assert(norm(await sessions.locator("summary").textContent()) === "Sessions (1) · 16:00–17:30",
    `sessions summary merges the count and first-last (got "${norm(await sessions.locator("summary").textContent())}")`);
  await sessions.locator("summary").click();
  assert(await readText(sessions.locator("li").first()) === "16:00–17:30", "session segment visible when opened");
  await sessions.locator("summary").click();
  assert(await top.locator("[data-testid=submissions]").getByText("Media Arts EHS — Module 1 Quiz · 17:21").isVisible(),
    "submission rendered course-first with its time");
  await top.locator("[data-testid=day-summary]").click();
  assert(await top.locator("[data-testid=day-detail]").isHidden(), "day detail hides again when collapsed");

  // keyboard toggle on another day
  const second = cardFor(page, "2026-09-16");
  await second.locator("[data-testid=day-summary]").focus();
  await page.keyboard.press("Enter");
  assert(await second.locator("[data-testid=active-minutes]").isVisible(), "keyboard expands a day summary");
  await page.keyboard.press("Enter");
  assert(await second.locator("[data-testid=active-minutes]").isHidden(), "keyboard collapses a day summary");

  // ---------- U4: bars removed ----------
  assert(await page.locator(".bar").count() === 0, "no bar elements remain");

  // ---------- U5: single week-level footer ----------
  assert(await page.locator("[data-testid=week-footer]").count() === 1, "exactly one week footer");
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data as of 2026-09-17 17:30",
    `footer shows latest activity in window (got "${await textIfPresent(page, "[data-testid=week-footer]")}")`);
  assert(await page.locator("[data-testid=data-as-of]").count() === 0, "per-card data-as-of removed");

  // ---------- U6: accessibility (compact contract) + AC15 ----------
  assert(await page.locator('nav[aria-label="Week navigation"]').count() === 1, "week navigation is a labelled nav");
  const nav = page.locator('nav[aria-label="Week navigation"]');
  assert(await nav.locator("[data-testid=prev-week]").count() === 1 &&
    await nav.locator("[data-testid=picker]").count() === 1 &&
    await nav.locator("[data-testid=next-week]").count() === 1, "nav wraps prev/picker/next");
  assert(await page.locator("h1").count() === 1, "page has one h1");
  assert((await page.locator("[data-testid=day-title]").first().evaluate((e) => e.tagName)) === "H3", "day dates are h3");
  const picker = page.locator("[data-testid=picker]");
  assert((await picker.getAttribute("min")) === "2026-08-31", `AC22 picker min is the earliest data week's Monday (got ${await picker.getAttribute("min")})`);
  assert((await picker.getAttribute("max")) === "2026-09-17", `AC22 picker max is today, not a future week (got ${await picker.getAttribute("max")})`);
  assert((await picker.inputValue()) === "2026-09-14", `picker value is the week anchor (got ${await picker.inputValue()})`);
  await top.locator("[data-testid=day-summary]").click();
  assert(await top.locator("[data-testid=day-detail]").count() === 1, "AC15 setup: detail present to inspect");
  // AC15 — the visible dt is the accessible label for its dd; no aria-label restatement.
  const activeAttrs = await ev(top.locator("[data-testid=day-detail] [data-testid=active-minutes]"), (e) => ({
    tag: e.tagName,
    parent: e.parentElement && e.parentElement.tagName,
    prev: e.previousElementSibling && e.previousElementSibling.textContent.trim(),
  }));
  assert(activeAttrs && activeAttrs.tag === "DD" && activeAttrs.parent === "DL" && activeAttrs.prev === "Active",
    `active-minutes is a dd whose previous dt is Active (got ${JSON.stringify(activeAttrs)})`);
  assert(await top.locator("[data-testid=day-detail] [aria-label]").count() === 0, "no aria-label restatement inside the detail");
  const activeSnap = await snap(top.locator("[data-testid=day-detail] dl").first());
  assert(activeSnap.includes("Active") && activeSnap.includes("1h 00m–1h 14m"),
    `dl ariaSnapshot carries the label and value (got ${JSON.stringify(activeSnap)})`);
  await top.locator("[data-testid=day-summary]").click();

  // ---------- U8 (default window): collapsed summaries fit 390px ----------
  const widths = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(widths.length === 4 && widths.every((w) => w.sw <= w.cw),
    `collapsed summaries do not overflow at 390px (got ${JSON.stringify(widths)})`);

  // ---------- AC21: prev/next browse calendar weeks; the heading follows ----------
  assert(await page.locator("[data-testid=next-week]").isDisabled(), "AC21 next is disabled at the current week");
  await page.click("[data-testid=prev-week]");
  await waitAnchor(page, "2026-09-07");
  t = await titles(page);
  assert(t.length === 7 && t[6] === "2026-09-13", `AC21 prev yields the previous calendar week (got ${t.join(",")})`);
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "Week of Sep 7",
    `AC21 heading follows the browsed week (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent())}")`);
  assert(await textIfPresent(page, "[data-testid=week-worked]") === "Worked 5 of 7 days", "AC21 prev band worked");
  assert(await textIfPresent(page, "[data-testid=week-active]") === "Active 3h 40m–4h 50m",
    `AC21 prev band active (got "${await textIfPresent(page, "[data-testid=week-active]")}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 0", "AC21 prev band quizzes");
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data as of 2026-09-11 17:30", "AC21 prev footer");
  assert(!(await page.locator("[data-testid=next-week]").isDisabled()), "AC21 next re-enables after moving back");
  await page.click("[data-testid=prev-week]");
  await waitAnchor(page, "2026-08-31");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "Week of Aug 31",
    `AC21 second prev heading (got "${norm(await page.locator("[data-testid=week-band] h2").first().textContent())}")`);
  assert(await page.locator("[data-testid=prev-week]").isDisabled(), "AC21 prev is disabled at the earliest data week");
  const blank = cardFor(page, "2026-08-31");
  assert(await readText(blank) === "2026-08-31 no activity",
    `elapsed day with no file keeps the no-activity one-liner (got "${await readText(blank)}")`);
  assert(await blank.locator("[data-testid=day-upcoming]").count() === 0, "elapsed empty day is not a future marker");
  assert(!/quiz/i.test(await readText(blank)), "elapsed empty day has no quiz badge");
  await page.click("[data-testid=next-week]");
  await page.click("[data-testid=next-week]");
  await waitAnchor(page, "2026-09-14");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    "AC21 returning to the current week restores This week");

  // ---------- AC22 + U7: picker maps a date to its containing week ----------
  await page.fill("[data-testid=picker]", "2026-09-08");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor(page, "2026-09-07");
  t = await titles(page);
  assert(t[0] === "2026-09-07" && t[6] === "2026-09-13",
    `AC22 picker maps 2026-09-08 to the week of Sep 7 (got ${t.join(",")})`);
  assert(await textIfPresent(page, "[data-testid=week-footer]") === "Data as of 2026-09-11 17:30", "AC22 footer follows the mapped week");

  const v2 = cardFor(page, "2026-09-08");
  await v2.locator("[data-testid=day-summary]").click();
  assert(await readText(v2.locator("[data-testid=day-detail] [data-testid=active-minutes]")) === "42m–56m",
    "v2 day still renders a range");
  await v2.locator("[data-testid=day-summary]").click();

  await page.fill("[data-testid=picker]", "2026-09-03");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor(page, "2026-08-31");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "Week of Aug 31",
    "AC22 picker maps 2026-09-03 to the week of Aug 31");

  const v1 = cardFor(page, "2026-09-03");
  assert(norm(await v1.locator("[data-testid=day-summary]").textContent()) === "2026-09-03 about 42m active",
    `v1 collapsed line uses the single number (got "${norm(await v1.locator("[data-testid=day-summary]").textContent())}")`);
  await v1.locator("[data-testid=day-summary]").click();
  const v1active = await readText(v1.locator("[data-testid=day-detail] [data-testid=active-minutes]"));
  assert(v1active === "42m", `v1 detail shows the legacy single number (got "${v1active}")`);
  assert(!/–/.test(v1active), "v1 detail invents no range");
  assert(await readText(v1.locator("[data-testid=course-line]").first()) === "Media Arts EHS 42m",
    "v1 course line uses the legacy minutes");
  assert(await v1.locator("[data-testid=quiz-line]").count() === 0, "v1 detail does not invent measured quiz time");
  await v1.locator("[data-testid=day-summary]").click();

  // ---------- U8 (browsed window): collapsed summaries fit 390px ----------
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
  await page.click("[data-testid=prev-week]");
  assert(await waitAnchor(page, "2026-09-07"), "AC23 prev moved off the current week");
  assert(await disabledIfPresent(jump) === false, "AC23 jump is enabled when browsing another week");
  assert(await clickIf(jump), "AC23 jump is clickable");
  assert(await waitAnchor(page, "2026-09-14"), "AC23 jump returns to the current week");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    "AC23 heading is This week after the jump");
  assert(await disabledIfPresent(jump) === true, "AC23 jump disables itself again");
  await page.fill("[data-testid=picker]", "2026-09-03");
  await page.dispatchEvent("[data-testid=picker]", "change");
  assert(await waitAnchor(page, "2026-08-31"), "AC23 picker moved to the week of Aug 31");
  assert(await disabledIfPresent(jump) === false, "AC23 jump re-enables after a picker jump");
  assert(await clickIf(jump), "AC23 jump is clickable from a picker window");
  assert(await waitAnchor(page, "2026-09-14"), "AC23 jump returns from the picker window");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    "AC23 heading restored after the picker jump");
  assert(await disabledIfPresent(jump) === true, "AC23 jump disabled at the current week again");

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
      return title && title.textContent.trim() === "2026-09-17";
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
  overrides.set("/data/2026-09-16.json", Buffer.from(JSON.stringify(multi)));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  const multiSummary = norm(await cardFor(page, "2026-09-16").locator("[data-testid=day-summary]").textContent());
  assert(multiSummary === "2026-09-16 about 1h 05m active 2 quizzes",
    `multiple submissions get a count badge (got "${multiSummary}")`);
  assert(await textIfPresent(page, "[data-testid=week-quizzes]") === "Quizzes submitted: 3",
    `band counts every submission (got "${await textIfPresent(page, "[data-testid=week-quizzes]")}")`);
  overrides.delete("/data/2026-09-16.json");

  assert(pageerrors.length === 0, `no pageerrors, got ${JSON.stringify(pageerrors)}`);
  await page.close();

  // ================= AC19 page — default view is the current ET calendar week =================
  const N = await openPage({ now: "2026-09-21T13:00:00Z" });
  const np = N.page;
  const npe = N.pageerrors;
  assert(await waitSel(np, "[data-testid=day-card]"), "AC19 setup: the calendar week renders");
  const t19 = await titles(np);
  assert(t19.join(",") === ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"].join(","),
    `AC19 Monday defaults to the current week ascending (got ${t19.join(",")})`);
  assert(norm(await np.locator("[data-testid=week-band] h2").first().textContent()) === "This week",
    `AC19 current-week heading (got "${norm(await np.locator("[data-testid=week-band] h2").first().textContent())}")`);
  assert(await textIfPresent(np, "[data-testid=week-worked]") === "Worked 0 of 7 days", "AC19 no data in the new week yet");
  assert(await textIfPresent(np, "[data-testid=week-active]") === "Active 0m", "AC19 zero active total");
  assert(await textIfPresent(np, "[data-testid=week-quizzes]") === "Quizzes submitted: 0", "AC19 zero quizzes");
  assert(await textIfPresent(np, "[data-testid=week-footer]") === "Data as of —", "AC19 empty footer");
  const today19 = cardFor(np, "2026-09-21");
  assert(await readText(today19) === "2026-09-21 no activity",
    `AC19 today (elapsed, no file) stays no-activity (got "${await readText(today19)}")`);
  assert(await today19.locator("[data-testid=day-upcoming]").count() === 0, "AC19 today is not a future marker");
  for (const date of ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]) {
    const card = cardFor(np, date);
    assert(await readText(card) === `${date} —`,
      `AC19 future day ${date} shows the muted marker (got "${await readText(card)}")`);
    assert(await card.locator("[data-testid=day-upcoming]").count() === 1, `AC19 future day ${date} carries day-upcoming`);
    assert(await card.locator("[data-testid=day-summary]").count() === 0, `AC19 future day ${date} is not expandable`);
  }
  assert(npe.length === 0, `AC19 no pageerrors, got ${JSON.stringify(npe)}`);
  await np.close();

  // ================= AC1/AC2/AC11/AC13/AC16/AC10/AC14 page =================
  const T = await openPage({ now: "2026-09-17T20:00:00Z" });
  const tp = T.page;
  const tpe = T.pageerrors;
  assert(await waitSel(tp, "[data-testid=today] [data-testid=active-minutes]"), "AC2 setup: Today's expanded detail renders on load");

  // AC1 — Today section exists, at the top, named for the injected current day.
  assert(await tp.locator("[data-testid=today]").count() === 1, "AC1 exactly one Today section");
  const todayPrecedesBand = await ev(tp.locator("[data-testid=today]"), (e) => {
    const band = document.querySelector("[data-testid=week-band]");
    return !!(band && (e.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  assert(todayPrecedesBand === true, "AC1 Today precedes the week band in DOM order");
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

  // AC2 — Today's compact detail is expanded with no interaction.
  const today = tp.locator("[data-testid=today]");
  assert(await today.locator("[data-testid=active-minutes]").isVisible(), "AC2 active value visible");
  assert(await readText(today.locator("[data-testid=active-minutes]")) === "1h 00m–1h 14m",
    `AC2 active value (got "${await readText(today.locator("[data-testid=active-minutes]"))}")`);
  assert(await readText(today.locator("[data-testid=quiz-line]")) === "25m",
    `AC2 measured quiz value (got "${await readText(today.locator("[data-testid=quiz-line]"))}")`);
  assert(await readText(today.locator("[data-testid=reading-line]")) === "35m–49m",
    `AC2 reading value (got "${await readText(today.locator("[data-testid=reading-line]"))}")`);
  const todayCourses = await today.locator("[data-testid=course-line]").allTextContents();
  assert(todayCourses.map(norm).join(" | ") === "Media Arts EHS 1h 00m | World History EHS 10m",
    `AC2 course rows (got ${JSON.stringify(todayCourses)})`);
  assert(await readText(today.locator("[data-testid=sessions] summary")) === "Sessions (1) · 16:00–17:30",
    `AC2 sessions summary (got "${await readText(today.locator("[data-testid=sessions] summary"))}")`);
  assert(await today.locator("[data-testid=submissions]").getByText("Media Arts EHS — Module 1 Quiz · 17:21").isVisible(),
    "AC2 submission visible inline");
  assert(await tp.locator("[data-testid=first-last]").count() === 0, "AC2 first-last testid removed");

  // AC13 — compact v2 detail; no repeated estimate wording.
  const topCard = cardFor(tp, "2026-09-17");
  await topCard.locator("[data-testid=day-summary]").click();
  const topDetail = topCard.locator("[data-testid=day-detail]");
  assert(await topDetail.count() === 1, "AC13 card expands into the shared detail");
  const dts = await topDetail.locator("dt").allTextContents();
  assert(dts.map(norm).join(" | ") === "Active | Quizzes (measured) | Reading",
    `AC13 metric labels are exact (got ${JSON.stringify(dts)})`);
  assert(await readText(topDetail.locator("[data-testid=active-minutes]")) === "1h 00m–1h 14m", "AC13 active value");
  assert(await readText(topDetail.locator("[data-testid=quiz-line]")) === "25m", "AC13 quiz value");
  assert(await readText(topDetail.locator("[data-testid=reading-line]")) === "35m–49m", "AC13 reading value");
  const cardCourses = await topDetail.locator("[data-testid=course-line]").allTextContents();
  assert(cardCourses.map(norm).join(" | ") === "Media Arts EHS 1h 00m | World History EHS 10m",
    `AC13 exactly two low-estimate course rows (got ${JSON.stringify(cardCourses)})`);
  assert(await readText(topDetail.locator("[data-testid=sessions] summary")) === "Sessions (1) · 16:00–17:30",
    `AC13 sessions summary merges count and span (got "${await readText(topDetail.locator("[data-testid=sessions] summary"))}")`);
  assert(await topDetail.locator("[data-testid=submissions]").getByText("Media Arts EHS — Module 1 Quiz · 17:21").isVisible(),
    "AC13 submission visible inline");
  const detailText = await readText(topDetail);
  for (const s of ["range", "(estimated)", "about "]) {
    assert(!detailText.includes(s), `AC13 detail does not repeat "${s}" (got ${JSON.stringify(detailText)})`);
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

  // AC10 — pinned across navigation (calendar-week windows).
  await tp.click("[data-testid=prev-week]");
  assert(await waitAnchor(tp, "2026-09-07"), "AC10 prev moved to the previous calendar week");
  await tp.fill("[data-testid=picker]", "2026-09-03");
  await tp.dispatchEvent("[data-testid=picker]", "change");
  assert(await waitAnchor(tp, "2026-08-31"), "AC10 picker moved to the mapped week");
  assert(await textIfPresent(tp, "[data-testid=today-date]") === "2026-09-17", "AC10 Today stays pinned across week navigation");
  assert(await tp.locator("[data-testid=today] [data-testid=active-minutes]").isVisible(), "AC10 Today detail still visible after navigation");

  // AC14 — v1 detail stays honest.
  const v1p = cardFor(tp, "2026-09-03");
  await v1p.locator("[data-testid=day-summary]").click();
  const v1d = v1p.locator("[data-testid=day-detail]");
  assert(await readText(v1d.locator("[data-testid=active-minutes]")) === "42m", "AC14 v1 active is a single value");
  assert(await v1d.locator("[data-testid=quiz-line]").count() === 0, "AC14 v1 has no quiz row");
  assert(await v1d.locator("[data-testid=reading-line]").count() === 0, "AC14 v1 has no reading row");
  assert(await readText(v1d.locator("[data-testid=course-line]").first()) === "Media Arts EHS 42m",
    "AC14 v1 course row uses estimated_minutes");
  assert(await v1d.locator("[data-testid=v1-note]").isVisible(), "AC14 v1 note visible");
  assert(await readText(v1d.locator("[data-testid=v1-note]")) === "estimated from session span", "AC14 v1 note text");
  // AC14's "no – range" is scoped to the metric duration values: the sessions
  // summary legitimately carries a time en-dash (16:00–17:30) per the plan.
  const v1metrics = await v1d.locator("dl.metrics dd").allTextContents();
  assert(v1metrics.length > 0 && !v1metrics.some((x) => x.includes("–")),
    `AC14 v1 metric values invent no durational range (got ${JSON.stringify(v1metrics)})`);
  await v1p.locator("[data-testid=day-summary]").click();
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
  assert(await ep.locator("[data-testid=today-empty]").isVisible(), "AC4 today-empty is visible");
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
  const openCard = cardFor(gp, "2026-09-16");
  await openCard.locator("[data-testid=day-summary]").click();
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
  assert(await textIfPresent(gp, "[data-testid=today-status]") === "Data retrieved Sep 17, 4:10 PM ET",
    `AC6 status shows the pipeline retrieval time, never the page clock (got "${await textIfPresent(gp, "[data-testid=today-status]")}")`);
  assert(await gp.evaluate(() => window.__marker) === 1, "AC6 no reload happened");
  assert(await openCard.locator("[data-testid=active-minutes]").isVisible(), "AC6 open day disclosure survives the render");
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
    return el && el.textContent.replace(/\s+/g, " ").trim() === "Data retrieved Sep 17, 4:10 PM ET";
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
  assert(await textIfPresent(ip, "[data-testid=today-status]") === "Data retrieved Sep 17, 4:10 PM ET",
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
  const RETRIEVED = "Data retrieved Sep 17, 4:10 PM ET";
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
    return el && el.textContent.replace(/\s+/g, " ").trim() === "Data retrieved Sep 17, 5:45 PM ET";
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

  await browser.close();
  server.close();
  console.log(failures ? "page.spec.js FAILED" : "page.spec.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
