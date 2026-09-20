// Nightly scraper: login via identity, login-as the student, then read the
// server-side activity log with a human-like paced request profile and write
// data/raw-events.json. Writes data/failure/* evidence on failure.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { mapActivity } = require("./map.js");
const { loadStore } = require("./store.js");
const { createPacer } = require("./pacing.js");

const BOARD_ROOT = "https://live.learnstage.com/exceled/excelhighschool/sis/dashboard";
const API = "https://api.learnstage.com";
const FAIL_DIR = path.join(__dirname, "data", "failure");
const IDLE_MS = 30000; // longest single element/navigation wait
const TIMEZONE = "America/New_York";
const PER_PAGE = 500;
const MAX_PAGES = 3;
const API_HEADERS = {
  Accept: "application/json",
  "realm-name": "sch-23-000a",
  "X-CW-Tenant-Id": "exceled",
};

// The dashboard 401s to identity with a redirect_url built from school data
// that may not have loaded yet on a cold visit, yielding "//login/auth" (empty
// district/school slugs). The SPA 404s that path and the token is never
// exchanged, so the later login-as call does not switch the session. Re-enter
// identity with the slugs from BOARD_ROOT so the exchange runs on
// /<district>/<school>/login/auth exactly as in a warm real-browser session.
async function ensureLoginRedirect(page) {
  const board = new URL(BOARD_ROOT);
  const want = `${board.origin}/${board.pathname.split("/").filter(Boolean).slice(0, 2).join("/")}/login/auth`;
  const u = new URL(page.url());
  if (u.searchParams.get("redirect_url") === want) return;
  u.searchParams.set("redirect_url", want);
  await page.goto(u.toString(), { waitUntil: "domcontentloaded" });
}

// Never persist auth material: strip JWT-shaped strings, then named token
// params in query (`?access_token=`), JSON (`"access_token": "..."`), and HTML.
const redact = (t) => String(t)
  .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "REDACTED")
  .replace(
    /((?:access[_-]?|refresh[_-]?|id[_-]?|session[_-]?)?token|session[_-]?id)(["']?\s*[:=]\s*["']?)[^&"'\s<]+/gi,
    "$1$2REDACTED"
  );

async function main() {
  const user = process.env.EXCEL_USERNAME;
  const pass = process.env.EXCEL_PASSWORD;
  if (!user || !pass) {
    console.error("EXCEL_USERNAME / EXCEL_PASSWORD not set");
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: TIMEZONE });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const consoleLines = [];
  const netLines = [];
  const inflight = new Map();
  const attach = (p) => {
    p.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") consoleLines.push(`${m.type()}: ${m.text()}`);
    });
    p.on("pageerror", (e) => consoleLines.push("pageerror: " + String(e)));
    p.on("framenavigated", (f) => {
      if (f === p.mainFrame()) netLines.push(`nav ${p.url()}`);
    });
  };
  context.on("page", attach);
  context.on("request", (r) => {
    const u = r.url();
    if (/learnstage\.com/.test(u)) {
      inflight.set(u, r.method());
      netLines.push(`req ${r.method()} ${u}`);
    }
  });
  context.on("response", (r) => {
    const u = r.url();
    if (!/learnstage\.com/.test(u)) return;
    inflight.delete(u);
    if (r.status() >= 400 || /student-activity|canvas\/page_view|loginAsCustomer/.test(u)) {
      netLines.push(`net ${r.status()} ${u}`);
    }
  });
  context.on("requestfailed", (r) => {
    const u = r.url();
    if (!/learnstage\.com/.test(u)) return;
    inflight.delete(u);
    netLines.push(`net FAILED ${u} :: ${(r.failure() && r.failure().errorText) || "unknown"}`);
  });

  const page = await context.newPage();

  const fail = async (error) => {
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    for (const [u, m] of inflight) netLines.push(`net PENDING ${m} ${u}`);
    const pages = context.pages();
    const info = {
      error: redact(String((error && error.stack) || error)),
      pages: pages.map((p) => ({ url: redact(p.url()), title: "" })),
    };
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      info.pages[i].title = await p.title().catch(() => "");
      try {
        const state = await p.evaluate(() => ({
          localKeys: Object.keys(localStorage),
          sessionKeys: Object.keys(sessionStorage),
          cookieNames: document.cookie.split(";").map((c) => c.split("=")[0].trim()),
          hasAuthData: !!localStorage.getItem("auth_data"),
        }));
        netLines.push(`storage page-${i} ${JSON.stringify(state)}`);
      } catch { /* page may be closed */ }
      await p.screenshot({ path: path.join(FAIL_DIR, `page-${i}.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(FAIL_DIR, `page-${i}.html`), redact(await p.content().catch(() => "")));
    }
    fs.writeFileSync(path.join(FAIL_DIR, "failure.json"), JSON.stringify(info, null, 2));
    fs.writeFileSync(path.join(FAIL_DIR, "console.log"), redact(consoleLines.join("\n")) || "(none)");
    fs.writeFileSync(path.join(FAIL_DIR, "network.log"), redact(netLines.join("\n")) || "(none)");
    await context.tracing.stop({ path: path.join(FAIL_DIR, "trace.zip") }).catch(() => {});
    console.error("scrape failed:", info.error, "\nevidence:", FAIL_DIR);
  };

  try {
    const pacer = createPacer();
    const fetchJson = async (url) => {
      const r = await page.evaluate(async ({ url, headers }) => {
        const started = Date.now();
        try {
          const res = await fetch(url, { headers, credentials: "include" });
          return { status: res.status, ms: Date.now() - started, body: await res.text() };
        } catch (e) {
          return { status: 0, ms: Date.now() - started, error: String(e), body: "" };
        }
      }, { url, headers: API_HEADERS });
      netLines.push(`api ${r.status} ${Math.round((r.ms || 0) / 100) / 10}s ${url}`);
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`GET ${url} -> ${r.status}${r.error ? ` ${r.error}` : ""} ${String(r.body).slice(0, 300)}`);
      }
      await pacer.pace();
      return JSON.parse(r.body);
    };

    await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });

    const loginForm = page.locator('input[name="password"]');
    const loginAsBtn = page.locator(`button[data-id="${config.student_data_id}"]`);
    const state = await Promise.race([
      loginForm.waitFor({ state: "visible", timeout: IDLE_MS }).then(() => "login").catch(() => null),
      loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS }).then(() => "dashboard").catch(() => null),
    ]);
    if (!state) throw new Error("neither login form nor Login-as button rendered");

    if (state === "login") {
      await ensureLoginRedirect(page);
      await page.locator('input[name="username"]').fill(user);
      await page.locator('input[name="password"]').fill(pass);
      await page.getByRole("button", { name: "Login" }).click();
      await page.waitForURL((u) => u.hostname === "live.learnstage.com", { timeout: IDLE_MS });
      const ready = await loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS })
        .then(() => true).catch(() => false);
      if (!ready) {
        await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });
        await loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS });
      }
    }

    const popupPromise = context.waitForEvent("page", { timeout: IDLE_MS }).catch(() => null);
    await loginAsBtn.click();
    await Promise.race([
      page.waitForEvent("load", { timeout: IDLE_MS }).catch(() => null),
      popupPromise,
    ]);
    const target = (await popupPromise) || page;
    await target.locator(`button[data-id="${config.student_data_id}"]`)
      .waitFor({ state: "detached", timeout: IDLE_MS }).catch(() => {});

    await target.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });
    await target.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {});

    const studentUrn = config.student_data_id;
    const enrollments = await fetchJson(`${API}/lms-core/api/enrollment/list?student_urn=${encodeURIComponent(studentUrn)}&q=&status=completed,active&perPage=1000&page=1&sortBy=created_at&sortOrder=desc`);
    const list = Array.isArray(enrollments) ? enrollments : enrollments.content || [];
    if (list.length === 0) throw new Error("no enrollments for configured student");
    const email = list[0].email || "";
    const schoolId = list[0].school_id || 10;
    const enrId = list[0].lms_enr_id;

    const stored = loadStore(path.join(__dirname, "data", "events"));
    const cutoff = stored.length ? stored[stored.length - 1].at_utc : null;

    const serverEvents = [];
    let pageNo = 1;
    let truncated = false;
    for (;;) {
      const data = await fetchJson(`${API}/activity-tracking-service/api/student-activity?enr_id=${encodeURIComponent(enrId)}&perPage=${PER_PAGE}&sortOrder=desc&page=${pageNo}`);
      const content = data.content || [];
      serverEvents.push(...content);
      const lastPage = data.last_page || 1;
      const oldest = content.length ? content[content.length - 1].created_at : null;
      if (pageNo >= lastPage) break;
      if (cutoff && oldest && oldest < cutoff) break;
      if (pageNo >= MAX_PAGES) { truncated = true; break; }
      pageNo++;
    }

    const attendance = await fetchJson(`${API}/sis-core/api/canvas/page_view?email=${encodeURIComponent(email)}&schoolId=${encodeURIComponent(schoolId)}`);
    const events = mapActivity(serverEvents, { timezone: TIMEZONE });
    if (events.length === 0) throw new Error("activity log returned no events");

    const raw = {
      fetched_at: new Date().toISOString(),
      source: "student-activity",
      timezone: TIMEZONE,
      last_attendance: attendance && attendance.lda ? attendance.lda : null,
      events,
    };
    if (truncated) raw.truncated = true;

    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "data", "raw-events.json"), JSON.stringify(raw, null, 2));
    await context.tracing.stop().catch(() => {});
    fs.rmSync(FAIL_DIR, { recursive: true, force: true });
    console.log(`scrape ok: ${events.length} events (${pageNo} page(s), last_attendance ${raw.last_attendance || "none"})`);
  } catch (e) {
    await fail(e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("scrape failed:", e); process.exit(1); });
}
module.exports = { redact, ensureLoginRedirect };
