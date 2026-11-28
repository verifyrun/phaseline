import {readFileSync,writeFileSync} from "node:fs";
import {traceProducer} from "../../index.mjs";
const [oldPath,currentPath,dest]=process.argv.slice(2);
const oldRecords=oldPath==="-" ? {} : JSON.parse(readFileSync(oldPath));
const current=JSON.parse(readFileSync(currentPath));
const answers={};
for (const [name,{event,receipts}] of Object.entries(current)) {
  const old=oldRecords[name]?.receipts ?? [];
  const views={
    logs:[...old,...receipts],
    tool_only:[...old,...receipts.map(({installation,...ident})=>ident)],
    no_current_log:old,
  };
  answers[name]=Object.fromEntries(Object.entries(views).map(([view,records])=>
    [view,traceProducer(event,records,text=>text===event.after)]));
}
writeFileSync(dest,JSON.stringify(answers,null,2)+"\n");
