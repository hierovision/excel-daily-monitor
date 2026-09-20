// Nightly scraper: dashboard -> login (identity.learnstage.com if redirected)
// -> "Login as" student -> My Courses (popup) -> Recent Activity feed.
// Writes data/raw-events.json; on failure writes data/failure/* evidence.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parse } = require("./parse.js");

const BOARD_ROOT = "https://live.learnstage.com/exceled/excelhighschool/sis/dashboard";
const FAIL_DIR = path.join(__dirname, "data", "failure");

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
  const attach = (p) => {
    p.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") consoleLines.push(`${m.type()}: ${m.text()}`);
    });
    p.on("pageerror", (e) => consoleLines.push("pageerror: " + String(e)));
  };
  context.on("page", attach);
  const page = await context.newPage();
  attach(page);
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);

  const fail = async (error) => {
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    const pages = context.pages();
    const pg = pages[pages.length - 1];
    const info = {
      url: pg ? pg.url() : null,
      title: pg ? await pg.title().catch(() => "") : null,
      error: String((error && error.stack) || error),
    };
    fs.writeFileSync(path.join(FAIL_DIR, "failure.json"), JSON.stringify(info, null, 2));
    if (pg) {
      await pg.screenshot({ path: path.join(FAIL_DIR, "failure.png"), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(FAIL_DIR, "page.html"), await pg.content().catch(() => ""));
    }
    fs.writeFileSync(path.join(FAIL_DIR, "console.log"), consoleLines.join("\n") || "(none)");
    await context.tracing.stop({ path: path.join(FAIL_DIR, "trace.zip") }).catch(() => {});
    console.error("scrape failed:", info.error, "\nevidence:", FAIL_DIR);
  };

  try {
    await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded" });

    // The dashboard URL redirects to identity.learnstage.com when not
    // authenticated. Wait for whichever state actually renders:
    // login form (needs credentials) or the student "Login as" button.
    const loginForm = page.locator('input[name="password"]');
    const loginAsBtn = page.locator(`button[data-id="${config.student_data_id}"]`);
    const state = await Promise.race([
      loginForm.waitFor({ state: "visible", timeout: 45000 }).then(() => "login").catch(() => null),
      loginAsBtn.waitFor({ state: "visible", timeout: 45000 }).then(() => "dashboard").catch(() => null),
    ]);
    if (!state) throw new Error("neither login form nor Login-as button rendered within 45s");

    if (state === "login") {
      await page.locator('input[name="username"]').fill(user);
      await page.locator('input[name="password"]').fill(pass);
      await page.getByRole("button", { name: "Login" }).click();
      // Post-login: wait for the student button instead of any fixed delay.
      await loginAsBtn.waitFor({ state: "visible", timeout: 60000 });
    }

    await loginAsBtn.click();
    const myCourses = page.getByRole("link", { name: "My Courses" }).first();
    await myCourses.waitFor({ state: "visible", timeout: 45000 });
    // Start listening before the click so the popup event cannot be missed.
    const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
    await myCourses.click();
    const popup = await popupPromise;
    const target = popup || page;
    target.setDefaultTimeout(30000);

    const container = target.locator("#scrollableDiv");
    await container.waitFor({ state: "visible", timeout: 45000 });

    // Infinite scroll: keep triggering the container's own scroll handler and
    // wait, per iteration, until the card count actually grows. Stop when the
    // count stops changing (bounded burst count, no fixed sleeps).
    const countCards = () => target.locator("#scrollableDiv .card_theme-icon").count();
    let seen = await countCards();
    for (let burst = 0; burst < 15; burst++) {
      const before = seen;
      await container.evaluate((el) => {
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

    const containerHtml = await container.innerHTML();
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

main().catch((e) => { console.error("scrape failed:", e); process.exit(1); });
