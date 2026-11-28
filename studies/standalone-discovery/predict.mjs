import {readFileSync, writeFileSync} from "node:fs";
import {decide} from "@verifyrun/phaseline";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const [schemaFile, inputs, rawFile, out] = process.argv.slice(2);
const service = read(schemaFile).find(s => s.service_name === "Hotels_4");
const required = service.intents.find(i => i.name === "ReserveHotel").required_slots;
const raw = read(rawFile);
const decisions = {};
function installed(fields, known) {
  const rules = fields.map(f => `fact ${f} from user.${f} owner observer`).join("\n")
    + "\nguarantee ready when " + fields.join(" and ");
  const records = fields.filter(f => known.has(f)).map(f => ({subject:"case", at:1, recorded:1,
    source:"user."+f, by:"observer", value:true}));
  const result = decide(rules, {subject:"case", at:1, asOf:1, records}).ready;
  return {ready:result.status === "release", asks:(result.needs ?? []).map(n=>n.fact)};
}
for (const r of read(inputs)) {
  const known = new Set(Object.keys(r.known).filter(k=>r.known[k].length));
  const inferred = new Set(raw[r.id]);
  const row = {always_hold:{ready:false,asks:[]},always_advance:{ready:true,asks:[]}};
  for (const [name, fields] of [["caller",required.slice(0,-1)],["full",required]]) {
    row[name] = installed(fields, known);
    row["raw_"+name] = installed(fields, inferred);
  }
  decisions[r.id] = row;
}
writeFileSync(out, JSON.stringify(decisions));
