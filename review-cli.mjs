import {readFileSync} from "node:fs";
import {readJSON} from "./exact-json.mjs";

export async function fundedCommand(args) {
  let journal,advanceReview;
  try {
    journal=await import("./review-journal.mjs");
    ({advanceReview}=await import("./funded-review.mjs"));
  } catch(e) {
    if (e.code==="ERR_UNKNOWN_BUILTIN_MODULE") return {status:"hold",reason:"This native durable handoff requires Node 22.13 or newer with node:sqlite available."};
    throw e;
  }
  const read=path=>readJSON(readFileSync(path,"utf8"));
  try {
    if (args[0]==="open" && args.length===4) {
      const trust=read(args[2]);
      if (!journal.exact(trust,["rootKey"])) throw new journal.Hold("Supply the separately pinned predecessor key.");
      return journal.enroll(args[1],trust.rootKey,read(args[3]));
    }
    if (args[0]==="step" && (args.length===3 || (args.length===4 && args[3]==="--recover"))) {
      const request=read(args[2]),db=journal.openExisting(args[1]);
      try { return advanceReview(db,request,args.length===4); }
      finally {db.close();}
    }
    throw Error("Use handoff open ACCOUNT.sqlite ROOT.json GRANT.json or handoff step ACCOUNT.sqlite REQUEST.json [--recover].");
  } catch(e) {
    if (e instanceof journal.Hold) return {status:"hold",reason:e.message};
    throw e;
  }
}
