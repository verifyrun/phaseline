// Compiles only if the published types describe the library entry.
import {decide, serve} from "@verifyrun/phaseline";
const result = decide("fact a from s.f owner o\nguarantee g when a\n", {subject: "x", at: 1, asOf: 2, records: []});
const status: string = result.g.status;
void status;
serve(0).then(server => { server.address(); server.close(); });
import {inquireOutput} from "@verifyrun/phaseline";
const observed = inquireOutput(["flag"], c => c.flag ? "yes" : "no", "yes", {known:{},readable:["flag"],budget:1});
if (observed.status === "ask") void observed.setting;
