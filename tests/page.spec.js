// U1-U8 — at-a-glance page: week band, collapsed day rows, progressive disclosure,
// no bars, single footer, a11y, v1 fallback, no overflow. (Plan revision 2026-09-20b.)
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
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const pageerrors = [];
  page.on("pageerror", (e) => pageerrors.push(String(e)));
  await page.goto("http://localhost:8931/", { waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");

  const textIfPresent = async (sel) => {
    try { return norm(await page.locator(sel).first().textContent({ timeout: 1000 })); } catch { return ""; }
  };
  const titles = async () => page.$$eval("[data-testid=day-title]", (els) => els.map((e) => e.textContent.trim()));
  const cardFor = (date) => page.locator(`[data-testid=day-card]`, { has: page.locator(`[data-testid=day-title]`, { hasText: date }) }).first();
  const summaryCount = () => page.locator("[data-testid=day-summary]").count();
  const waitAnchor = (date) => page.waitForFunction(
    (d) => {
      const el = document.querySelector("[data-testid=day-title]");
      return el && el.textContent.trim() === d;
    }, date);

  // ---------- U2 (setup): 7 day rows, newest first, empty days are one-liners ----------
  let t = await titles();
  assert(t.length === 7, `default window shows 7 day rows (got ${t.length})`);
  assert(t[0] === "2026-09-17", `newest day first (got ${t[0]})`);
  assert(t.join(",") === ["2026-09-17", "2026-09-16", "2026-09-15", "2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11"].join(","),
    `default window is the newest 7 days (got ${t.join(",")})`);

  // ---------- U1: week band (default window) ----------
  assert(await page.locator("[data-testid=week-band]").count() === 1, "exactly one week band");
  assert((await page.locator("[data-testid=week-band]").getAttribute("aria-live")) === "polite", "week band is aria-live=polite");
  assert(norm(await page.locator("[data-testid=week-band] h2").first().textContent()) === "This week", "band heading is This week");
  assert(await textIfPresent("[data-testid=week-worked]") === "Worked 5 of 7 days",
    `default band worked line (got "${await textIfPresent("[data-testid=week-worked]")}")`);
  assert(await textIfPresent("[data-testid=week-active]") === "Active (estimated): about 5h 11m · range 4h 36m–5h 46m",
    `default band active line (got "${await textIfPresent("[data-testid=week-active]")}")`);
  assert(await textIfPresent("[data-testid=week-quizzes]") === "Quizzes submitted: 1",
    `default band quizzes line (got "${await textIfPresent("[data-testid=week-quizzes]")}")`);
  const weekSubs = page.locator("[data-testid=week-band] details");
  assert(norm(await weekSubs.locator("summary").textContent()) === "Show submissions", "band submissions behind a disclosure");
  await weekSubs.locator("summary").click();
  assert(await weekSubs.getByText("Submitted: Module 1 Quiz — Media Arts EHS").isVisible(), "band submission item visible when opened");
  await weekSubs.locator("summary").click();

  // ---------- U2: collapsed day lines ----------
  assert(await summaryCount() === 5, `only active days are expandable (got ${await summaryCount()} summaries)`);
  const top = cardFor("2026-09-17");
  assert(norm(await top.locator("[data-testid=day-summary]").textContent()) === "2026-09-17 about 1h 07m active Quiz submitted",
    `collapsed top line (got "${norm(await top.locator("[data-testid=day-summary]").textContent())}")`);
  assert(norm(await cardFor("2026-09-16").locator("[data-testid=day-summary]").textContent()) === "2026-09-16 about 1h 05m active",
    "collapsed line has a quiz badge only when submissions exist");
  for (const sel of ["active-minutes", "quiz-line", "reading-line", "courses", "sessions", "first-last", "submissions"]) {
    assert(await top.locator(`[data-testid=${sel}]`).isHidden(), `detail ${sel} hidden before expansion`);
  }
  const empty = cardFor("2026-09-13");
  assert(norm(await empty.textContent()) === "2026-09-13 no activity",
    `empty day is a muted one-liner (got "${norm(await empty.textContent())}")`);
  assert(await empty.locator("[data-testid=day-summary]").count() === 0, "empty day is not expandable");
  assert((await empty.evaluate((e) => e.tagName)) !== "DETAILS", "empty day is not a details element");
  assert(!/quiz/i.test(await empty.textContent()), "empty day has no quiz badge");

  // ---------- U3: progressive disclosure on the top day ----------
  await top.locator("[data-testid=day-summary]").click();
  assert(await top.locator("[data-testid=active-minutes]").isVisible(), "active line visible after expansion");
  assert(await top.locator("[data-testid=active-minutes]").textContent().then(norm) ===
    "Active (estimated): about 1h 00m · range 1h 00m–1h 14m", "active detail line (plain + range)");
  assert(await top.locator("[data-testid=quiz-line]").textContent().then(norm) ===
    "Quizzes (measured): 25m · 1 submitted", "quiz detail line (measured + count)");
  assert(await top.locator("[data-testid=reading-line]").textContent().then(norm) ===
    "Reading (estimated): about 35m · range 35m–49m", "reading detail line (plain + range)");
  const courses = await top.locator("[data-testid=course-line]").allTextContents();
  assert(courses.map(norm).join(" | ") === "Media Arts EHS — 1h 00m active | World History EHS — 10m active",
    `course lines (got ${JSON.stringify(courses)})`);
  const sessions = top.locator("[data-testid=sessions]");
  assert(norm(await sessions.locator("summary").textContent()) === "Session times", "sessions nested under its own summary");
  await sessions.locator("summary").click();
  assert(await sessions.getByText("16:00–17:30").isVisible(), "session time visible when opened");
  await sessions.locator("summary").click();
  assert(await top.locator("[data-testid=first-last]").textContent().then(norm) === "First to last activity: 16:00–17:30",
    "first-to-last line (HH:MM)");
  assert(await top.locator("[data-testid=submissions]").getByText("Submitted: Module 1 Quiz — Media Arts EHS").isVisible(),
    "submission item rendered");
  await top.locator("[data-testid=day-summary]").click();
  assert(await top.locator("[data-testid=active-minutes]").isHidden(), "day detail hides again when collapsed");

  // keyboard toggle on another day
  const second = cardFor("2026-09-16");
  await second.locator("[data-testid=day-summary]").focus();
  await page.keyboard.press("Enter");
  assert(await second.locator("[data-testid=active-minutes]").isVisible(), "keyboard expands a day summary");
  await page.keyboard.press("Enter");
  assert(await second.locator("[data-testid=active-minutes]").isHidden(), "keyboard collapses a day summary");

  // ---------- U4: bars removed ----------
  assert(await page.locator(".bar").count() === 0, "no bar elements remain");

  // ---------- U5: single week-level footer ----------
  assert(await page.locator("[data-testid=week-footer]").count() === 1, "exactly one week footer");
  assert(await textIfPresent("[data-testid=week-footer]") === "Data as of 2026-09-17 17:30",
    `footer shows latest activity in window (got "${await textIfPresent("[data-testid=week-footer]")}")`);
  assert(await page.locator("[data-testid=data-as-of]").count() === 0, "per-card data-as-of removed");

  // ---------- U6: accessibility ----------
  assert(await page.locator('nav[aria-label="Week navigation"]').count() === 1, "week navigation is a labelled nav");
  const nav = page.locator('nav[aria-label="Week navigation"]');
  assert(await nav.locator("[data-testid=prev-week]").count() === 1 &&
    await nav.locator("[data-testid=picker]").count() === 1 &&
    await nav.locator("[data-testid=next-week]").count() === 1, "nav wraps prev/picker/next");
  assert(await page.locator("h1").count() === 1, "page has one h1");
  assert((await page.locator("[data-testid=day-title]").first().evaluate((e) => e.tagName)) === "H3", "day dates are h3");
  const picker = page.locator("[data-testid=picker]");
  assert((await picker.getAttribute("min")) === "2026-09-08", `picker min is the earliest full-window anchor (got ${await picker.getAttribute("min")})`);
  assert((await picker.getAttribute("max")) === "2026-09-17", `picker max is the newest day (got ${await picker.getAttribute("max")})`);
  await top.locator("[data-testid=day-summary]").click();
  const activeLabel = await top.locator("[data-testid=active-minutes]").getAttribute("aria-label");
  assert(/between 1h 00m and 1h 14m \(estimated\)/.test(activeLabel || ""),
    `active line aria-label names the estimate (got "${activeLabel}")`);
  const readingLabel = await top.locator("[data-testid=reading-line]").getAttribute("aria-label");
  assert(/between 35m and 49m \(estimated\)/.test(readingLabel || ""),
    `reading line aria-label names the estimate (got "${readingLabel}")`);
  const quizLabel = await top.locator("[data-testid=quiz-line]").getAttribute("aria-label");
  assert(/measured/i.test(quizLabel || "") && /25m/.test(quizLabel || "") && /1 submitted/.test(quizLabel || ""),
    `quiz line aria-label names the measurement (got "${quizLabel}")`);
  const activeSnap = await top.locator("[data-testid=active-minutes]").ariaSnapshot();
  assert(activeSnap.includes("between 1h 00m and 1h 14m (estimated)"),
    `active accessible name exposed (snapshot: ${JSON.stringify(activeSnap)})`);
  await top.locator("[data-testid=day-summary]").click();

  // ---------- U8 (default window): collapsed summaries fit 390px ----------
  const widths = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(widths.length === 5 && widths.every((w) => w.sw <= w.cw),
    `collapsed summaries do not overflow at 390px (got ${JSON.stringify(widths)})`);

  // ---------- week navigation bounds + band updates ----------
  assert(await page.locator("[data-testid=next-week]").isDisabled(), "next is disabled at the newest bound");
  await page.click("[data-testid=prev-week]");
  await waitAnchor("2026-09-10");
  t = await titles();
  assert(t.length === 7 && t[6] === "2026-09-04", `prev shifts the window by 7 days (got ${t.join(",")})`);
  assert(await textIfPresent("[data-testid=week-worked]") === "Worked 7 of 7 days", "band updates on prev");
  assert(await textIfPresent("[data-testid=week-active]") === "Active (estimated): about 5h 29m · range 4h 40m–6h 18m",
    `band active updates on prev (got "${await textIfPresent("[data-testid=week-active]")}")`);
  assert(await textIfPresent("[data-testid=week-quizzes]") === "Quizzes submitted: 0", "band quizzes update on prev");
  assert(await textIfPresent("[data-testid=week-footer]") === "Data as of 2026-09-10 17:30", "footer follows the window");
  assert(!(await page.locator("[data-testid=next-week]").isDisabled()), "next re-enables after moving back");
  await page.click("[data-testid=prev-week]");
  await waitAnchor("2026-09-08");
  assert(await page.locator("[data-testid=prev-week]").isDisabled(), "prev is disabled at the oldest full-window anchor");
  await page.click("[data-testid=next-week]");
  await page.click("[data-testid=next-week]");
  await waitAnchor("2026-09-17");

  // ---------- U7 + U1: picker re-anchors; v1 fallback in every layer ----------
  await page.fill("[data-testid=picker]", "2026-09-08");
  await page.dispatchEvent("[data-testid=picker]", "change");
  await waitAnchor("2026-09-08");
  t = await titles();
  assert(t[0] === "2026-09-08" && t[6] === "2026-09-02", `picker ends the window on the picked date (got ${t.join(",")})`);
  assert(await textIfPresent("[data-testid=week-worked]") === "Worked 7 of 7 days", "band updates on picker change");
  assert(await textIfPresent("[data-testid=week-active]") === "Active (estimated): about 5h 04m · range 4h 22m–5h 46m",
    `band normalizes the v1 day into both bounds (got "${await textIfPresent("[data-testid=week-active]")}")`);
  assert(await textIfPresent("[data-testid=week-quizzes]") === "Quizzes submitted: 0", "band quizzes update on picker change");
  assert(await textIfPresent("[data-testid=week-footer]") === "Data as of 2026-09-08 17:30", "footer follows the picked window");

  const v1 = cardFor("2026-09-03");
  assert(norm(await v1.locator("[data-testid=day-summary]").textContent()) === "2026-09-03 about 42m active",
    `v1 collapsed line uses the single number (got "${norm(await v1.locator("[data-testid=day-summary]").textContent())}")`);
  await v1.locator("[data-testid=day-summary]").click();
  const v1active = norm(await v1.locator("[data-testid=active-minutes]").textContent());
  assert(v1active === "42 min active (span 90 min)", `v1 detail shows the legacy single number (got "${v1active}")`);
  assert(!/[–-]/.test(v1active), "v1 detail invents no range");
  assert(norm(await v1.locator("[data-testid=course-line]").first().textContent()) === "Media Arts EHS — 42m active",
    "v1 course line uses the legacy minutes");
  assert(await v1.locator("[data-testid=quiz-line]").count() === 0, "v1 detail does not invent measured quiz time");
  await v1.locator("[data-testid=day-summary]").click();

  const v2 = cardFor("2026-09-08");
  await v2.locator("[data-testid=day-summary]").click();
  assert(norm(await v2.locator("[data-testid=active-minutes]").textContent()) ===
    "Active (estimated): about 42m · range 42m–56m", "v2 day still renders a range");
  await v2.locator("[data-testid=day-summary]").click();

  // ---------- U8 (picker window): collapsed summaries fit 390px ----------
  const widths2 = await page.$$eval("[data-testid=day-summary]", (els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  assert(widths2.length === 7 && widths2.every((w) => w.sw <= w.cw),
    `picked-window summaries do not overflow at 390px (got ${JSON.stringify(widths2)})`);

  // ---------- HTTP cache regression (Pages serves max-age=600) ----------
  const fresh = JSON.parse(fs.readFileSync(path.join(site, "data", "2026-09-17.json"), "utf8"));
  fresh.active_minutes_low = 99;
  fresh.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(fresh)));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid=active-minutes]");
    return el && el.textContent.includes("1h 39m");
  }, null, { timeout: 5000 }).catch(() => {});
  const reloaded = await textIfPresent("[data-testid=active-minutes]");
  assert(reloaded.includes("1h 39m"), `reload picks up the redeployed day file, not the cached one (got "${reloaded}")`);
  overrides.delete("/data/2026-09-17.json");

  // ---------- coverage expansion: a day with more than one submission badges the count ----------
  const multi = JSON.parse(fs.readFileSync(path.join(site, "data", "2026-09-16.json"), "utf8"));
  multi.submissions_and_grades = [
    { item: "Module 2 Quiz", course: "World History EHS", at: "15:48" },
    { item: "Module 3 Quiz", course: "World History EHS", at: "17:37" },
  ];
  overrides.set("/data/2026-09-16.json", Buffer.from(JSON.stringify(multi)));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  const multiSummary = norm(await cardFor("2026-09-16").locator("[data-testid=day-summary]").textContent());
  assert(multiSummary === "2026-09-16 about 1h 05m active 2 quizzes",
    `multiple submissions get a count badge (got "${multiSummary}")`);
  assert(await textIfPresent("[data-testid=week-quizzes]") === "Quizzes submitted: 3",
    `band counts every submission (got "${await textIfPresent("[data-testid=week-quizzes]")}")`);
  overrides.delete("/data/2026-09-16.json");

  assert(pageerrors.length === 0, `no pageerrors, got ${JSON.stringify(pageerrors)}`);

  await browser.close();
  server.close();
  console.log(failures ? "page.spec.js FAILED" : "page.spec.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
