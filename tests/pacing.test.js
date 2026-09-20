// R8 — realistic network profile: bounded jitter, serial sequencing, no bursts.
const { paceDelay, createPacer, runSerial } = require("../pacing.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};
const eq = (a, b, msg) => assert(a === b, `${msg} (got ${a}, want ${b})`);

eq(paceDelay(() => 0), 450, "paceDelay lower bound");
eq(paceDelay(() => 1), 800, "paceDelay upper bound");

(async () => {
  const waits = [];
  const pacer = createPacer({ rng: () => 0, wait: async (ms) => { waits.push(ms); } });
  for (let i = 0; i < 4; i++) await pacer.pace();
  assert(waits.slice(0, 4).every((w) => w === 450), `four bounded gaps first (got ${waits})`);
  eq(waits[4], 1500, "reading pause after the burst window");
  const p2 = createPacer({ rng: () => 0.99, wait: async (ms) => { waits.push(ms); } });
  for (let i = 0; i < 6; i++) await p2.pace();
  assert(waits.slice(5).every((w) => w <= 800), "no pause when the random roll says no");

  const order = [];
  const results = await runSerial([
    async () => { order.push("a"); return 1; },
    async () => { order.push("b"); return 2; },
  ], p2);
  eq(order.join(","), "a,b", "runSerial is strictly serial");
  eq(results.length, 2, "runSerial returns each result");
  console.log(failures ? "pacing.test.js FAILED" : "pacing.test.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
