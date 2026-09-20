// Security regression guard: auth material must never survive into artifacts.
const { redact } = require("../scrape.js");

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cm4iOiJ1cm46Y3VzdG9tZXJzIn0.signaturepart_123";
let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); failures++; } };

const cases = [
  ["query param", `https://x//login/auth?access_token=${JWT}&foo=1`, "access_token=REDACTED"],
  ["json value", `{"access_token":"${JWT}","other":true}`, '"access_token":"REDACTED"'],
  ["html inline", `<script>window.token = "${JWT}"</script>`, "window.token = \"REDACTED\""],
  ["bearer header", `Authorization: Bearer ${JWT}`, "Bearer REDACTED"],
  ["opaque named token", "token=opaquevalue123&x=1", "token=REDACTED"],
  ["session id json", '{"session_id":"f3bede5a-bc30-4d68-9431-7a9cf9bc9cb0"}', '"session_id":"REDACTED"'],
];
for (const [name, input, expected] of cases) {
  const out = redact(input);
  assert(out.includes(expected), `${name}: expected ${JSON.stringify(expected)} in ${JSON.stringify(out)}`);
  assert(!out.includes(JWT), `${name}: JWT survived`);
}
// non-secret text is preserved
const essay = "Submitted Module 1 Quiz at 21:21:19 for Media Arts EHS";
assert(redact(essay) === essay, "ordinary text untouched");

console.log(failures ? "redact.test.js FAILED" : "redact.test.js ok");
process.exit(failures ? 1 : 0);
