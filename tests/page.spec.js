// R7 — 7-day windowed page: default window, week nav, date picker, ranges, v1 fallback.
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

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
  const pageerrors = [];
  page.on("pageerror", (e) => pageerrors.push(String(e)));
  await page.goto("http://localhost:8931/", { waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");

  const titles = async () => page.$$eval("[data-testid=day-title]", (els) => els.map((e) => e.textContent.trim()));
  const cardFor = (date) => page.locator(`[data-testid=day-card]`, { has: page.locator(`[data-testid=day-title]`, { hasText: date }) }).first();

  // default: newest 7 available days, newest first
  let t = await titles();
  assert(t.length === 7, `default window shows 7 cards (got ${t.length})`);
  assert(t[0] === "2026-09-17", `newest day first (got ${t[0]})`);
  assert(t.join(",") === ["2026-09-17", "2026-09-16", "2026-09-15", "2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11"].join(","),
    `default window is the newest 7 days (got ${t.join(",")})`);

  // range + measured/reading lines on the top card
  const active = (await cardFor("2026-09-17").locator("[data-testid=active-minutes]").textContent()) || "";
  assert(/active/i.test(active), `active line labelled (got "${active}")`);
  assert(/\d+\s*[^0-9]{1,3}\s*\d+/.test(active) && /–|-/.test(active), `active line shows a range (got "${active}")`);
  const rq = (await cardFor("2026-09-17").locator("[data-testid=reading-quizzes]").textContent()) || "";
  assert(/reading/i.test(rq) && /quiz/i.test(rq), `reading + quizzes line rendered (got "${rq}")`);

  // week navigation bounds
  assert(await page.locator("[data-testid=next-week]").isDisabled(), "next is disabled at the newest bound");
  await page.click("[data-testid=prev-week]");
  await page.waitForFunction(() => {
    const el = document.querySelector("[data-testid=day-title]");
    return el && el.textContent.trim() === "2026-09-10";
  });
  t = await titles();
  assert(t.length === 7 && t[6] === "2026-09-04", `prev shifts the window by 7 days (got ${t.join(",")})`);
  assert(!(await page.locator("[data-testid=next-week]").isDisabled()), "next re-enables after moving back");
  await page.click("[data-testid=prev-week]");
  await page.waitForFunction(() => document.querySelector("[data-testid=day-title]").textContent.trim() === "2026-09-08");
  t = await titles();
  assert(t[6] === "2026-09-02", `oldest window reaches the first day (got ${t.join(",")})`);
  assert(await page.locator("[data-testid=prev-week]").isDisabled(), "prev is disabled at the oldest bound");
  await page.click("[data-testid=next-week]");
  await page.click("[data-testid=next-week]");
  await page.waitForFunction(() => document.querySelector("[data-testid=day-title]").textContent.trim() === "2026-09-17");

  // date picker re-anchors the window and v1 files fall back gracefully
  await page.fill("[data-testid=picker]", "2026-09-08");
  await page.waitForFunction(() => document.querySelector("[data-testid=day-title]").textContent.trim() === "2026-09-08");
  t = await titles();
  assert(t[0] === "2026-09-08" && t[6] === "2026-09-02", `picker ends the window on the picked date (got ${t.join(",")})`);
  const v1 = (await cardFor("2026-09-03").locator("[data-testid=active-minutes]").textContent()) || "";
  assert(/^\s*\d+\s*min active/.test(v1) && !/[–-]/.test(v1), `v1 day falls back to a single number (got "${v1}")`);
  const v2 = (await cardFor("2026-09-08").locator("[data-testid=active-minutes]").textContent()) || "";
  assert(/[–-]/.test(v2), `v2 day still renders a range (got "${v2}")`);

  // data must bypass the HTTP cache: Pages serves max-age=600, so a stale day
  // file would otherwise be reused after a redeploy (observed 2026-09-20).
  const fresh = JSON.parse(fs.readFileSync(path.join(site, "data", "2026-09-17.json"), "utf8"));
  fresh.active_minutes_low = 99;
  fresh.active_minutes_high = 99;
  overrides.set("/data/2026-09-17.json", Buffer.from(JSON.stringify(fresh)));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("[data-testid=active-minutes]").textContent.includes("1h 39m"),
    null, { timeout: 5000 }).catch(() => {});
  const reloaded = (await page.locator("[data-testid=active-minutes]").first().textContent()) || "";
  assert(reloaded.includes("1h 39m"), `reload picks up the redeployed day file, not the cached one (got "${reloaded}")`);
  overrides.delete("/data/2026-09-17.json");

  assert(pageerrors.length === 0, `no pageerrors, got ${JSON.stringify(pageerrors)}`);

  await browser.close();
  server.close();
  console.log(failures ? "page.spec.js FAILED" : "page.spec.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
