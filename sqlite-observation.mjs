// Run the optional standard-library SQLite adapter only when requested.
import {isAbsolute} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const reader = fileURLToPath(new URL("./sqlite-observation.py", import.meta.url));
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const price = value => Number.isSafeInteger(value) && value >= 0;
export function observeSqlite(database, before, after, terms) {
  return read("queries", database, before, after, terms);
}
export function observeSqliteViews(database, before, after, terms) {
  return read("views", database, before, after, terms);
}
// The receiver loads this policy independently. The proposer supplies only recipient identities.
export function checkSqliteRecipients(policy, proposed) {
  if (!object(policy)) return {status: "hold", reason: "receiver_policy_required"};
  const {database, views, ...terms} = policy;
  if (typeof database !== "string" || !isAbsolute(database) || !Array.isArray(views)
      || views.length !== 2 || !Array.from(views).every(v => typeof v === "string" && v.length > 0)
      || !Array.isArray(terms.editionDigests) || Object.hasOwn(terms, "expectedAfter"))
    return {status: "hold", reason: "receiver_policy_required"};
  if (!Array.isArray(proposed)) return {status: "hold", reason: "recipient_proposal_required"};
  return observeSqliteViews(database, views[0], views[1], {...terms, expectedAfter: proposed});
}
function read(mode, database, before, after, terms) {
  if (![database, before, after].every(s => typeof s === "string" && s.length > 0 && Buffer.byteLength(s) <= 200_000))
    throw Error("Supply a SQLite file and two SQL editions of at most 200,000 bytes each.");
  if (!object(terms) || Object.keys(terms).some(k => !["recipient", "grants", "budget", "editionDigests", "expectedAfter"].includes(k))
      || typeof terms.recipient !== "string" || !terms.recipient.length || !price(terms.budget) || !object(terms.grants))
    throw Error("Supply a recipient column, a nonnegative integer budget and table/column grants.");
  if (terms.expectedAfter !== undefined) {
    const ids = terms.expectedAfter;
    if (!Array.isArray(ids) || ids.length > 2048 || new Set(ids).size !== ids.length
        || !Array.from(ids).every(id => Number.isSafeInteger(id) || (typeof id === "string" && id.length > 0 && Buffer.byteLength(id) <= 512)))
      throw Error("Supply at most 2048 distinct text or exact-integer expected recipients.");
  }
  if (terms.editionDigests !== undefined && (!Array.isArray(terms.editionDigests)
      || terms.editionDigests.length !== 2 || !Array.from(terms.editionDigests).every(d => typeof d === "string" && /^[a-f0-9]{64}$/.test(d))))
    throw Error("Supply the two expected SHA-256 edition digests.");
  for (const [table, columns] of Object.entries(terms.grants)) {
    if (!table || !object(columns) || !Object.values(columns).every(price))
      throw Error("Each granted column must have a nonnegative integer price.");
  }
  const input = JSON.stringify({mode, database, before, after, terms});
  if (Buffer.byteLength(input) > 2_000_000) throw Error("Observation request is too large.");
  const run = spawnSync("python3", ["-I", reader], {input, encoding: "utf8", timeout: 15_000, maxBuffer: 16_000_000});
  if (run.error || run.status !== 0) return {status: "hold", reason: run.error?.code === "ETIMEDOUT" ? "work_limit" : "observer_unavailable"};
  return JSON.parse(run.stdout);
}
