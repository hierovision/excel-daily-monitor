// Nightly scraper: login -> Login as (student) -> My Courses -> Recent Activity.
// Writes data/raw-events.json. Fails loud (exit 1) when the flow breaks.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { parse } = require("./parse.js");

const BOARD_ROOT = "https://live.learnstage.com/exceled/excelhighschool/sis/dashboard";

async function main() {
  const user = process.env.EXCEL_USERNAME;
  const pass = process.env.EXCEL_PASSWORD;
  if (!user || !pass) {
    console.error("EXCEL_USERNAME / EXCEL_PASSWORD not set"); process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Some orgs land on a login form first; fill it when present.
    const loginField = page.locator('input[name="username"], input[type="email"], input[type="text"]').first();
    if (await loginField.count() && await loginField.isVisible().catch(() => false)) {
      await loginField.fill(user);
      await page.locator('input[type="password"]').first().fill(pass);
      await page.getByRole("button", { name: /log\s?in/i }).first().click();
      await page.waitForLoadState("load");
    }

    // "Login as" for the configured student.
    const loginAs = page.locator(`button[data-id="${config.student_data_id}"]`).first();
    if (await loginAs.count()) {
      await loginAs.click();
      await page.waitForLoadState("load");
    } else {
      console.error('"Login as" button with configured data-id not found — is config.json current?');
      process.exit(1);
    }

    // Left sidebar -> My Courses (opens the LMS dashboard in a new tab).
    const [lmsPage] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }).catch(() => null),
      page.getByRole("link", { name: "My Courses" }).first().click(),
    ]);
    const coursePage = lmsPage || page;
    await coursePage.waitForLoadState("load");

    // Recent Activity container + infinite scroll.
    const feed = coursePage.locator("#scrollableDiv .infinite-scroll-component").first();
    await feed.waitFor({ timeout: 30000 });

    const html = [];
    for (let burst = 0; burst < 10; burst++) {
      html.push(await feed.innerText()); // placeholder guard so the locator is alive each burst
      await feed.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await coursePage.waitForTimeout(800); // network-dependent, bounded
    }
    const containerHtml = await coursePage.locator("#scrollableDiv").innerHTML();

    const events = parse(containerHtml);
    if (events.length === 0) {
      console.error("Scraped 0 events — site layout may have changed. Raw html at data/raw-page.html");
      fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
      fs.writeFileSync(path.join(__dirname, "data", "raw-page.html"), containerHtml);
      process.exit(1);
    }
    fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "data", "raw-events.json"), JSON.stringify({ fetched_at: new Date().toISOString(), events }, null, 2));
    console.log(`scrape ok: ${events.length} events`);
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error("scrape failed:", e); process.exit(1); });
