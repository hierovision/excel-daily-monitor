// CI environment policy: the browser comes from a pinned Playwright image,
// the npm package is exact-pinned to that image's version, and no job installs
// OS packages or browsers at runtime.
const fs = require("fs");
const path = require("path");

let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); failures++; } };

const root = path.resolve(__dirname, "..");
const read = (rel) => {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const version = lock.packages["node_modules/playwright"].version;
const imagePrefix = `mcr.microsoft.com/playwright:v${version}-noble@sha256:`;
const daily = read(".github/workflows/daily.yml");
const ci = read(".github/workflows/ci.yml");

assert(fs.existsSync(path.join(root, ".github/workflows/daily.yml")), "daily.yml exists");
assert(fs.existsSync(path.join(root, ".github/workflows/ci.yml")), "ci.yml exists");
assert(pkg.dependencies.playwright === version, `package.json pins playwright exactly to ${version}`);
assert(
  lock.packages[""] && lock.packages[""].dependencies &&
    lock.packages[""].dependencies.playwright === version,
  `lockfile root spec pins playwright exactly to ${version}`,
);

for (const [name, text] of [["daily.yml", daily], ["ci.yml", ci]]) {
  assert(text.includes(imagePrefix), `${name}: uses the ${version} Playwright image`);
  assert(
    /mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}/.test(text),
    `${name}: pins the image by digest`,
  );
  assert(!/npx playwright install/.test(text), `${name}: no runtime browser install`);
  assert(!/install-deps|apt-get/.test(text), `${name}: no runtime OS dependency install`);
  assert(!/actions\/setup-node/.test(text), `${name}: uses the image's Node, not setup-node`);
  assert(/runs-on:\s*ubuntu-24\.04/.test(text), `${name}: pins the runner to ubuntu-24.04`);
  assert(!/ubuntu-latest/.test(text), `${name}: no ubuntu-latest`);
  assert(/timeout-minutes:\s*15/.test(text), `${name}: bounds the job to 15 minutes`);
  assert(/shell:\s*bash/.test(text), `${name}: keeps bash semantics`);
  assert(new RegExp(`PLAYWRIGHT_VERSION:\\s*"?${version.replace(/\./g, "\\.")}"?`).test(text), `${name}: pins PLAYWRIGHT_VERSION`);
  assert(
    /Verify Playwright version matches the container image/.test(text),
    `${name}: guards Playwright version drift`,
  );
}

assert(/schedule:/.test(daily), "daily.yml keeps the schedule trigger");
assert(/workflow_dispatch:/.test(daily), "daily.yml keeps manual dispatch");
assert(/cancel-in-progress:\s*false/.test(daily), "daily.yml queues schedule runs");
assert(/contents:\s*write/.test(daily), "daily.yml keeps the data-commit permission");
assert(/node scrape\.js/.test(daily), "daily.yml still scrapes");
assert(/node summarize\.js/.test(daily), "daily.yml still summarizes");
assert(/data\/failure\/failure\.json/.test(daily), "daily.yml still uploads failure evidence");
assert(/git push/.test(daily), "daily.yml still commits data");

assert(/pull_request:/.test(ci), "ci.yml runs on pull_request");
assert(/permissions:\s*\n\s*contents:\s*read/.test(ci), "ci.yml is read-only");
assert(/cancel-in-progress:\s*true/.test(ci), "ci.yml cancels superseded PR runs");
assert(!/EXCEL_USERNAME|EXCEL_PASSWORD/.test(ci), "ci.yml does not use scrape secrets");
assert(/node tests\/workflow\.test\.js/.test(read("package.json")), "npm test runs this policy test");

// Pages deploy policy: publish only after a successful scrape, and keep the
// bounded retry that covers GitHub's intermittent "no artifacts found" listing
// fault (2026-11-19 onward). Three attempts, one pinned SHA — a dropped attempt
// would silently restore the flake, a diverged SHA would run two versions.
const deploy = read(".github/workflows/deploy-pages.yml");
assert(fs.existsSync(path.join(root, ".github/workflows/deploy-pages.yml")), "deploy-pages.yml exists");
assert(/workflow_run:/.test(deploy), "deploy-pages.yml still runs on scrape completion");
assert(
  /github\.event\.workflow_run\.conclusion == 'success'/.test(deploy),
  "deploy-pages.yml only deploys after a successful scrape",
);
assert(/pages:\s*write/.test(deploy), "deploy-pages.yml keeps the Pages publish permission");
assert(/id-token:\s*write/.test(deploy), "deploy-pages.yml keeps the OIDC permission");
assert(/upload-pages-artifact@[0-9a-f]{40}/.test(deploy), "deploy-pages.yml uploads the Pages artifact");
const deployPins = deploy.match(/actions\/deploy-pages@[0-9a-f]{40}/g) || [];
assert(deployPins.length === 3, "deploy-pages.yml keeps three deploy attempts");
assert(new Set(deployPins).size === 1, "deploy-pages.yml pins one deploy-pages SHA");
assert(
  /if: steps\.deployment\.outcome == 'failure'/.test(deploy) &&
    /if: steps\.deployment_retry\.outcome == 'failure'/.test(deploy),
  "deploy-pages.yml gates each retry on the previous attempt failing",
);

console.log(failures ? "workflow.test.js FAILED" : "workflow.test.js ok");
process.exit(failures ? 1 : 0);
