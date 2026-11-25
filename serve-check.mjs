// The local service answers like the commands and refuses what it should.
import assert from "node:assert/strict";
import {request} from "node:http";
import {serve} from "./serve.mjs";
import {compareContracts, decide} from "./evidence-source.mjs";

const server = await serve(0), port = server.address().port;
function call(method, path, body, headers = {"content-type": "application/json"}) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
    const sent = request({host: "127.0.0.1", port, method, path, headers: {...headers, "content-length": Buffer.byteLength(text)}}, response => {
      let data = "";
      response.on("data", part => data += part);
      response.on("end", () => resolve([response.statusCode, JSON.parse(data)]));
    });
    sent.on("error", reject);
    sent.end(text);
  });
}
const rules = "# refund desk\nfact paid from billing.active owner ops\nfact reviewed from desk.review owner lead\nguarantee refund when paid and reviewed\n";
const record = (source, by, value) => ({subject: "order-1", at: 5, recorded: 5, source, by, value});
const full = {subject: "order-1", at: 5, asOf: 9, records: [record("billing.active", "ops", true), record("desk.review", "lead", true)]};
const partial = {...full, records: full.records.slice(0, 1)};
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepEqual(await call("GET", "/health"), [200, {status: "ok", version: (await import("node:fs")).readFileSync(new URL("package.json", import.meta.url), "utf8").match(/"version": "([^"]+)"/)[1]}]);
assert.deepEqual(await call("POST", "/decide", {rules, case: full}), [200, plain(decide(rules, full))]);
assert.equal((await call("POST", "/decide", {rules, case: full}))[1].refund.status, "release");
const held = await call("POST", "/decide", {rules, case: partial});
assert.equal(held[1].refund.status, "hold"); assert.equal(held[1].refund.needs[0].owner, "lead");
assert.deepEqual((await call("POST", "/decide", {rules, case: full, explain: true}))[1], plain(decide(rules, full, {explain: true})));
const revised = rules.replace("paid and reviewed", "paid");
const compared = await call("POST", "/compare", {old: rules, new: revised});
assert.equal(compared[1].status, "review"); assert.deepEqual(compared[1].changes, plain(compareContracts(rules, revised).result.changes));
assert.equal((await call("POST", "/compare", {old: rules, new: rules}))[1].status, "preserved");

for (const [args, code, pattern] of [
  [["POST", "/decide", {rules, case: full, extra: 1}], 400, /Unknown field: extra/],
  [["POST", "/decide", {rules, case: {...full, recrods: []}}], 400, /Unknown field in the case: recrods/],
  [["POST", "/decide", '{"rules":"x","rules":"y"}'], 400, /appears twice/],
  [["POST", "/decide", "{not json"], 400, /not valid JSON/],
  [["POST", "/decide", {case: full}], 400, /rule file text/],
  [["POST", "/decide", {rules: "guarantee g when", case: full}], 400, /Line 1/],
  [["POST", "/decide", "[" .repeat(20000) + "]".repeat(20000)], 400, /nested too deeply|not valid JSON/],
  [["POST", "/compare", {old: rules}], 400, /old and new/],
  [["POST", "/decide", {rules, case: full}, {"content-type": "text/plain"}], 415, /application\/json/],
  [["GET", "/decide"], 405, /POST/],
  [["POST", "/files", {}], 404, /POST \/decide/],
  [["POST", "/decide", {rules, case: full}, {"content-type": "application/json", host: "example.com"}], 403, /127\.0\.0\.1/],
]) {
  const [status, body] = await call(...args);
  assert.equal(status, code, JSON.stringify(args[1]) + " " + JSON.stringify(body)); assert.equal(body.status, "hold"); assert.match(body.reason, pattern);
}
const large = await call("POST", "/decide", {rules: "x".repeat(1100000), case: full}).catch(error => [413, {status: "hold", reason: "closed: " + error.code}]);
assert.equal(large[0], 413);
assert.equal(server.address().address, "127.0.0.1");
await assert.rejects(serve(port), /in use/);
server.close();

// The library entry gives the same answers.
const library = await import("./index.mjs");
assert.deepEqual(plain(library.decide(rules, partial)), held[1]);
assert.equal(library.gate(rules, full, "refund"), true);
assert.equal(library.gate(rules, partial, "refund"), false);
assert.throws(() => library.gate(rules, full, "no_such"), /declared guarantee/);
assert.deepEqual(plain(library.compare(rules, revised)), compared[1]);
assert.equal(library.compare(rules, rules).status, "preserved");
console.log("Local service: decisions and comparisons match the commands; 12 refusals, the size limit, the loopback binding and the library entry passed.");
