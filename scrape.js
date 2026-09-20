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
      await page.locator('input[name="username"]').fill(user);
      await page.locator('input[name="password"]').fill(pass);
      await page.getByRole("button", { name: "Login" }).click();

      // After submit the identity service 302s back to live.learnstage.com.
      // Its own /login/auth exchange route is broken in this deployment (the
      // redirect arrives as a doubled slash and the SPA token exchange 404s),
      // but the identity session cookies already authenticate the SPA — so go
      // straight to the dashboard instead of replaying the token route.
      await page.waitForURL(/live\.learnstage\.com/, { timeout: IDLE_MS });
      await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });
      await loginAsBtn.waitFor({ state: "visible", timeout: IDLE_MS });
    }

    // Login-as calls the API and then reloads the dashboard in the student
    // context. Watch for either that reload or a new tab, then head straight
    // to the LMS dashboard — that is where the Recent Activity feed lives
    // (the sidebar link is "My Courses" for the parent, "Go To Courses"/LMS
    // for the student; navigating directly skips the sidebar shape-shifting).
    const popupPromise = context.waitForEvent("page", { timeout: IDLE_MS }).catch(() => null);
    await loginAsBtn.click();
    await Promise.race([
      page.waitForEvent("load", { timeout: IDLE_MS }).catch(() => null),
      popupPromise,
    ]);
    const target = (await popupPromise) || page;

    await target.goto(LMS_DASHBOARD, { waitUntil: "domcontentloaded" }).catch(() => {});
    let feedPage = target;
    const hasFeed = await feedPage.locator("#scrollableDiv")
      .waitFor({ state: "visible", timeout: IDLE_MS }).then(() => true).catch(() => false);
    if (!hasFeed) {
      // Direct navigation may need the sidebar click instead (or SSO bounced).
      const link = feedPage.getByRole("link", { name: /My Courses|Go To Courses/i }).first();
      await link.waitFor({ state: "visible", timeout: IDLE_MS });
      const next = context.waitForEvent("page", { timeout: IDLE_MS }).catch(() => null);
      await link.click();
      feedPage = (await next) || feedPage;
    }
    const feedContainer = feedPage.locator("#scrollableDiv");
    await feedContainer.waitFor({ state: "visible", timeout: IDLE_MS });

    // Infinite scroll: keep triggering the container's own scroll handler and
    // wait, per iteration, until the card count actually grows. Stop when the
    // count stops changing (bounded burst count, no fixed sleeps).
    const countCards = () => feedPage.locator("#scrollableDiv .card_theme-icon").count();
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
      const grew = await feedPage.waitForFunction(
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
