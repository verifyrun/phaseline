// Seal complete decision trees without opening the receiver's flags or golden files.
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {inquireOutput} from "../../index.mjs";
const fields = ["skipStringNormalization","skipMagicTrailingComma","lineLength80"];
function tree(rows, known={}) {
  const read = config => rows[fields.reduce((n,k)=>n*2+Number(config[k]),0)];
  const result = inquireOutput(fields,read,rows[0],{known,readable:fields,budget:3-Object.keys(known).length});
  if (result.status==="ask") return {ask:result.setting,answers:[false,true].map(v=>tree(rows,{...known,[result.setting]:v}))};
  return result.status==="decided" ? {matches:result.matches} : {hold:result.reason};
}
const results = {};
for (const file of process.argv.slice(3)) {
  const {version,results:cases} = JSON.parse(readFileSync(file,"utf8"));
  results[version] = Object.fromEntries(Object.entries(cases).map(([id,rows])=>[id,
    rows.some(r=>typeof r!=="string") ? {hold:"unmeasured rendering"} :
    {candidate:createHash("sha256").update(rows[0]).digest("hex"),tree:tree(rows)}]));
}
writeFileSync(process.argv[2],JSON.stringify(results,null,2)+"\n");
