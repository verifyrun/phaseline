// Compiles only if the published types describe the library entry.
import {decide, serve} from "@verifyrun/phaseline";
const result = decide("fact a from s.f owner o\nguarantee g when a\n", {subject: "x", at: 1, asOf: 2, records: []});
const status: string = result.g.status;
void status;
serve(0).then(server => { server.address(); server.close(); });

import {observeSqlite, observeSqliteViews} from "@verifyrun/phaseline";
const terms = {recipient: "id", grants: {records: {id: 1}}, budget: 1};
const observed = observeSqlite("source.db", "select id from records", "select id from records", terms);
if (observed.status === "observed") observed.after.map(id => String(id));
const views = observeSqliteViews("source.db", "old", "new", terms);
if (views.status === "hold") String(views.need?.column);
