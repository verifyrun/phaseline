// Property tests with fast-check. They check decide against a reference written
// from the README, and that malformed input is refused rather than read as missing.
import fc from "fast-check";
import assert from "node:assert/strict";
import {decide} from "@verifyrun/phaseline";

const owners = fc.constantFrom("hr", "mgr");
const sources = fc.constantFrom("hr.ok", "hr.other");
const record = fc.record({
  subject: fc.constantFrom("s", "t"), at: fc.nat(1000), recorded: fc.nat(1000),
  source: sources, by: owners, value: fc.boolean(),
});
const mode = fc.constantFrom("", " standing", " standing at event", " latest");

// What the README says each mode reads.
function reference(records, packet, mode, within) {
  const standing = mode.startsWith(" standing"), atEvent = mode === " standing at event";
  let rows = records.filter(r => r.subject === packet.subject && r.source === "hr.ok" && r.by === "hr" &&
    r.recorded <= packet.asOf && (standing ? r.at <= (atEvent ? packet.at : packet.asOf)
                                           : r.at === packet.at && r.recorded >= packet.at));
  if (standing && rows.length) { const effective = Math.max(...rows.map(r => r.at)); rows = rows.filter(r => r.at === effective); }
  if (within !== undefined && rows.length) { rows = rows.filter(r => packet.asOf - r.recorded <= within); if (!rows.length) return "hold"; }
  if (rows.length && (standing || mode === " latest")) { const last = Math.max(...rows.map(r => r.recorded)); rows = rows.filter(r => r.recorded === last); }
  if (!rows.length || new Set(rows.map(r => r.value)).size > 1) return "hold";
  return rows[0].value ? "release" : "withhold";
}

fc.assert(fc.property(fc.array(record, {maxLength: 6}), fc.nat(1000), fc.nat(1000), mode,
  fc.option(fc.integer({min: 1, max: 400}), {nil: undefined}),
  (records, at, span, mode, within) => {
    const packet = {subject: "s", at, asOf: at + span, records};
    const rule = `fact ok from hr.ok owner hr${mode}${within === undefined ? "" : " within " + within}\nguarantee go when ok\n`;
    assert.equal(decide(rule, packet).go.status, reference(records, packet, mode, within));
  }), {numRuns: 5000, seed: 20261125});

// Any non-whole time or unknown field in a record is refused, never treated as missing.
fc.assert(fc.property(record, fc.oneof(
    fc.record({key: fc.constantFrom("at", "recorded"), value: fc.oneof(fc.string(), fc.double({noInteger: true}), fc.constant(null))}),
    fc.record({key: fc.string({minLength: 1}).filter(k => !["subject","at","recorded","source","by","value","__proto__"].includes(k)), value: fc.jsonValue()})),
  (base, {key, value}) => {
    const broken = {...base, [key]: value};
    assert.throws(() => decide("fact ok from hr.ok owner hr\nguarantee go when ok\n", {subject: "s", at: 0, asOf: 1000, records: [broken]}));
  }), {numRuns: 2000, seed: 20261125});

console.log("property tests passed: 7,000 generated cases");
