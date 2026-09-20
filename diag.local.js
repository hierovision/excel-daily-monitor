// LOCAL DIAGNOSTIC ONLY — not part of the app, never pushed.
// Run: EXCEL_USERNAME='...' EXCEL_PASSWORD='...' node diag.local.js
// Walks: dashboard -> (login?) -> Login as -> My Courses -> Recent Activity.
// Dumps screenshots/HTML/JSON to .opencode/diagnostics/<stamp>/ — no secrets ever written.
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BOARD_ROOT = "https://live.learnstage.com/exceled/excelhighschool/sis/dashboard";
const OUT = path.join(__dirname, ".opencode", "diagnostics", new Date().toISOString().replace(/[:.]/g, "-"));
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const summary = { started_at: new Date().toISOString(), steps: [], console: [] };
let stepNo = 0;

function record(name, page, response, notes) {
  stepNo++;
  const tag = String(stepNo).padStart(2, "0") + "-" + name;
  return (async () => {
    const info = { name, url: page.url(), title: await page.title().catch(() => ""),
      status: response ? response.status() : null, notes: notes || [] };
    try { await page.screenshot({ path: path.join(OUT, tag + ".png"), fullPage: true }); } catch {}
    try { fs.writeFileSync(path.join(OUT, tag + ".html"), await page.content()); } catch {}
    info.inventory = await page.evaluate(() => {
      const vis = (el) => !!(el.offsetParent || el.getClientRects().length);
      const inputs = [...document.querySelectorAll("input")].map(i => ({
        type: i.type, name: i.name || null, id: i.id || null,
        placeholder: i.placeholder || null, ariaLabel: i.getAttribute("aria-label"),
        visible: vis(i) }));
      const buttons = [...document.querySelectorAll("button")].slice(0, 60).map(b => ({
        text: (b.innerText || "").trim().slice(0, 40), dataId: b.getAttribute("data-id"),
        type: b.type, visible: vis(b) }));
      const links = [...document.querySelectorAll("a")].slice(0, 80).map(a => ({
        text: (a.innerText || "").trim().slice(0, 40), href: a.getAttribute("href"),
        target: a.getAttribute("target"), visible: vis(a) }));
      return { inputs, buttons: buttons.filter(b => b.visible).slice(0, 40),
        links: links.filter(l => l.visible && l.text).slice(0, 40),
        hasFeed: !!document.querySelector("#scrollableDiv"),
        hasLoginAs: [...document.querySelectorAll("button")].some(b => /login as/i.test(b.innerText || "")),
        hasRecentActivity: /recent activity/i.test(document.body.innerText || ""),
        feedCards: document.querySelectorAll(".card_theme-icon").length,
        iframes: [...document.querySelectorAll("iframe")].map(f => f.src),
        bodyText: (document.body.innerText || "").slice(0, 600) };
    }).catch(e => ({ error: String(e) }));
    summary.steps.push(info);
    console.log(`[${tag}] url=${info.url} status=${info.status} feed=${info.inventory && info.inventory.hasFeed} loginAs=${info.inventory && info.inventory.hasLoginAs} cards=${info.inventory && info.inventory.feedCards}`);
  })();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200); // settle SPA hydration; diagnostics only
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") summary.console.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", e => summary.console.push("pageerror: " + String(e)));
  page.on("dialog", d => { summary.console.push("dialog: " + d.message()); d.dismiss().catch(() => {}); });
  const popups = [];
  context.on("page", p => popups.push(p));

  const user = process.env.EXCEL_USERNAME, pass = process.env.EXCEL_PASSWORD;
  console.log(user ? "credentials: provided" : "credentials: NOT provided (anonymous run)");

  let resp = await page.goto(BOARD_ROOT, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => { summary.console.push("goto error: " + String(e)); return null; });
  await settle(page);
  await record("initial", page, resp);

  // If a visible password field exists, attempt login.
  const pw = page.locator('input[type="password"]').first();
  if (user && await pw.count() && await pw.isVisible().catch(() => false)) {
    const userField = page.locator('input[type="email"]:visible, input[name="username"]:visible, input[type="text"]:visible').first();
    await userField.fill(user).catch(e => summary.console.push("fill user: " + String(e)));
    await pw.fill(pass).catch(e => summary.console.push("fill pass: " + String(e)));
    const submit = page.locator('button[type="submit"]:visible, button:has-text("Log in"):visible, button:has-text("Login"):visible, button:has-text("Sign in"):visible').first();
    await submit.click().catch(e => summary.console.push("submit: " + String(e)));
    await settle(page);
    resp = null;
    await record("after-login", page, resp);
  } else {
    summary.steps.push({ name: "login-skipped", notes: ["no visible password field" + (user ? "" : " (no creds)")] });
  }

  // Login as student.
  const loginAs = page.locator(`button[data-id="${config.student_data_id}"]`).first();
  if (await loginAs.count() && await loginAs.isVisible().catch(() => false)) {
    await loginAs.click();
    await settle(page);
    await record("after-login-as", page, null);
  } else {
    await record("login-as-missing", page, null, ["button with configured data-id not found"]);
  }

  // My Courses (may open a popup).
  const myCourses = page.locator('a:has-text("My Courses"), a:has-text("My courses")').first();
  if (await myCourses.count() && await myCourses.isVisible().catch(() => false)) {
    await myCourses.click();
    await page.waitForTimeout(3000);
    const target = popups.length ? popups[popups.length - 1] : page;
    await settle(target);
    await record("after-my-courses", target, null);
  } else {
    await record("my-courses-missing", page, null, ["My Courses link not found"]);
  }

  // Feed + scroll bursts.
  const feedPage = popups.length ? popups[popups.length - 1] : page;
  const feed = feedPage.locator("#scrollableDiv").first();
  if (await feed.count()) {
    for (let i = 0; i < 10; i++) {
      await feed.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await feedPage.waitForTimeout(1000);
    }
    await record("feed-after-scroll", feedPage, null);
    const cards = await feedPage.locator(".card_theme-icon").count();
    console.log(`feed cards after scroll: ${cards}`);
    fs.writeFileSync(path.join(OUT, "feed.html"), await feedPage.locator("#scrollableDiv").innerHTML());
  } else {
    await record("feed-missing", feedPage, null, ["#scrollableDiv not found"]);
  }

  summary.finished_at = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("artifacts:", OUT);
  await browser.close();
})().catch(e => { console.error("diag failed:", e); process.exit(1); });
