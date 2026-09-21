// AC24 — bounded empty-activity retry: incremental 15s/30s/60s backoff on the
// existing session, returning the last result and never throwing for emptiness.
const { withEmptyRetry } = require("../scrape.js");

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { console.error("FAIL:", msg); failures++; }
};

(async () => {
  assert(typeof withEmptyRetry === "function", "scrape exports withEmptyRetry");
  if (typeof withEmptyRetry === "function") {
    const event = { id: "e1", kind: "page_viewed" };

    // Empty twice, then one event: the event wins after 3 calls, 2 sleeps.
    const callsA = [];
    const sleepsA = [];
    const resultA = await withEmptyRetry(
      async () => { callsA.push(1); return callsA.length <= 2 ? [] : [event]; },
      { sleep: async (ms) => { sleepsA.push(ms); } }
    );
    assert(resultA.length === 1 && resultA[0] === event,
      `recovered value is the last fetch result (got ${JSON.stringify(resultA)})`);
    assert(callsA.length === 3, `empty twice then one event calls 3x (got ${callsA.length})`);
    assert(sleepsA.join(",") === "15000,30000",
      `backoff sleeps are exactly 15s then 30s (got ${sleepsA.join(",")})`);

    // Always empty: all 4 attempts, all three sleeps, returns the empty value.
    const callsB = [];
    const sleepsB = [];
    const resultB = await withEmptyRetry(
      async () => { callsB.push(1); return []; },
      { sleep: async (ms) => { sleepsB.push(ms); } }
    );
    assert(Array.isArray(resultB) && resultB.length === 0,
      `always-empty returns the empty value without throwing (got ${JSON.stringify(resultB)})`);
    assert(callsB.length === 4, `always-empty exhausts 4 attempts (got ${callsB.length})`);
    assert(sleepsB.join(",") === "15000,30000,60000",
      `always-empty sleeps 15s/30s/60s (got ${sleepsB.join(",")})`);

    // Non-empty first: one call, no sleep.
    const callsC = [];
    const sleepsC = [];
    const resultC = await withEmptyRetry(
      async () => { callsC.push(1); return [event]; },
      { sleep: async (ms) => { sleepsC.push(ms); } }
    );
    assert(resultC.length === 1 && resultC[0] === event, "non-empty first result is returned as-is");
    assert(callsC.length === 1, `non-empty first calls once (got ${callsC.length})`);
    assert(sleepsC.length === 0, `non-empty first never sleeps (got ${sleepsC.join(",")})`);
  }

  console.log(failures ? "scrape-retry.test.js FAILED" : "scrape-retry.test.js ok");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
