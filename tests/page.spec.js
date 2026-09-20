// AC5/AC6 — index.html renders the fixture day via Playwright (served statically).
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
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/data/index.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(fs.readFileSync(path.join(root, "tests", "fixtures", "index.json")));
      return;
    }
    const file = path.join(root, url === "/" ? "index.html" : url);
    if (fs.existsSync(file)) {
      res.setHeader("Content-Type",
        file.endsWith(".json") ? "application/json" : "text/html");
      res.end(fs.readFileSync(file));
    } else { res.statusCode = 404; res.end("nf"); }
  });
  await new Promise(r => server.listen(8931, r));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageerrors = [];
  page.on("pageerror", e => pageerrors.push(String(e)));
  await page.goto("http://localhost:8931/", { waitUntil: "load" });
  await page.waitForSelector("[data-testid=day-card]");
  // top card renders most recent date, active minutes, courses, "data as of"
  assert((await page.textContent("[data-testid=day-title]")).includes("2026-09-17"),
    "top card title contains the latest date");
  const active = await page.textContent("[data-testid=active-minutes]");
  assert(/active/.test(active) && /\d/.test(active), `active minutes line rendered: ${active}`);
  const body = await page.textContent("body");
  assert(body.includes("Media Arts EHS") && body.includes("World History EHS"),
    "both course names are rendered");
  assert(body.includes("data as of"), "stale-data line rendered");
  assert(pageerrors.length === 0, `no pageerrors, got ${JSON.stringify(pageerrors)}`);

  await browser.close();
  server.close();
  console.log(failures ? "page.spec.js FAILED" : "page.spec.js ok");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
