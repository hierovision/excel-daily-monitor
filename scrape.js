// Nightly scraper: dashboard -> login (identity.learnstage.com if redirected)
// -> "Login as" student -> My Courses (popup) -> Recent Activity feed.
// Writes data/raw-events.json; on failure writes data/failure/* evidence.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parse } = require("./parse.js");

const BOARD_ROOT = "https://live.learnstage.com/exceled/excelhighschool/sis/dashboard";
const LMS_DASHBOARD = "https://live.lms.learnstage.com/exceled/excelhighschool/sis/lms/dashboard";
const FAIL_DIR = path.join(__dirname, "data", "failure");
const IDLE_MS = 30000; // longest single element/navigation wait

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
    if (r.status() >= 400 || /login\/school\/auth|loginAsCustomer/.test(u)) {
      netLines.push(`net ${r.status()} ${u}`);
    }
    if (/loginAsCustomer/.test(u)) {
      r.text().then((b) => netLines.push(`body ${u} :: ${b.slice(0, 400)}`)).catch(() => {});
    }
  });
  context.on("requestfailed", (r) => {
    const u = r.url();
    if (!/learnstage\.com/.test(u)) return;
    inflight.delete(u);
    netLines.push(`net FAILED ${u} :: ${(r.failure() && r.failure().errorText) || "unknown"}`);
  });

  const page = await context.newPage(); // the context "page" event attaches listeners

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
    await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });

    // The dashboard URL redirects to identity.learnstage.com when not
    // authenticated. Wait for whichever state actually renders: login form
    // (needs credentials) or the student "Login as" button.
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

      // Wait for the navigation itself (host predicate — a URL regex would
      // also match this identity page's redirect_url query). The SPA then
      // exchanges the token and lands on the dashboard.
      await page.waitForURL((u) => u.hostname === "live.learnstage.com", { timeout: IDLE_MS });
      const ready = await loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS })
        .then(() => true).catch(() => false);
      if (!ready) {
        await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });
        await loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS });
      }
    }

    // Login-as calls the API and reloads the dashboard in the student context.
    // Wait for the reload and for the parent's Login-as button to disappear
    // (session switch) before hopping to the LMS — the LMS reads that same
    // server-side session, so going early loads the parent's enrollments.
    const popupPromise = context.waitForEvent("page", { timeout: IDLE_MS }).catch(() => null);
    await loginAsBtn.click();
    await Promise.race([
      page.waitForEvent("load", { timeout: IDLE_MS }).catch(() => null),
      popupPromise,
    ]);
    const target = (await popupPromise) || page;
    await target.locator(`button[data-id="${config.student_data_id}"]`)
      .waitFor({ state: "detached", timeout: IDLE_MS }).catch(() => {});

    await target.goto(LMS_DASHBOARD, { waitUntil: "domcontentloaded" });
    const feedContainer = target.locator("#scrollableDiv");
    await feedContainer.waitFor({ state: "visible", timeout: IDLE_MS });

    // Infinite scroll: keep triggering the container's own scroll handler and
    // wait, per iteration, until the card count actually grows. Stop when the
    // count stops changing (bounded burst count, no fixed sleeps).
    const countCards = () => target.locator("#scrollableDiv .card_theme-icon").count();
    let seen = await countCards();
    for (let burst = 0; burst < 15; burst++) {
      const before = seen;
      await feedContainer.evaluate((el) => {
        // Scroll every actually-scrollable element inside the feed container;
        // the infinite-scroll handler may live on an inner div, not on #scrollableDiv.
        const nodes = [el, ...el.querySelectorAll("*")];
        for (const n of nodes) {
          const style = getComputedStyle(n);
          const scrollable = /auto|scroll/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 20;
          if (scrollable) n.scrollTop = n.scrollHeight;
        }
      });
      const grew = await target.waitForFunction(
        (n) => document.querySelectorAll("#scrollableDiv .card_theme-icon").length > n,
        before,
        { timeout: 4000 }
      ).then(() => true).catch(() => false);
      seen = await countCards();
      if (!grew) break;
    }

    const containerHtml = await feedContainer.innerHTML();
    const events = parse(containerHtml);
    if (events.length === 0) {
      fs.mkdirSync(FAIL_DIR, { recursive: true });
      fs.writeFileSync(path.join(FAIL_DIR, "feed.html"), containerHtml);
      throw new Error(`parsed 0 events from ${seen} cards — feed markup may have changed`);
    }
    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, "data", "raw-events.json"),
      JSON.stringify({ fetched_at: new Date().toISOString(), events }, null, 2)
    );
    await context.tracing.stop().catch(() => {});
    fs.rmSync(FAIL_DIR, { recursive: true, force: true });
    console.log(`scrape ok: ${events.length} events (${seen} cards)`);
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
module.exports = { redact };
