// External adapter for Rich's published bug-report template, run on opening text alone.
import {decide} from "@verifyrun/phaseline";
import {readFileSync, writeFileSync} from "node:fs";
const [input,out]=process.argv.slice(2);
const rules = `fact repro from report.repro owner reader
fact platform from report.platform owner reader
fact visual from report.visual owner reader
fact terminal from report.terminal owner reader
guarantee triage when repro and (not visual or (platform and terminal))`;
const prompts={repro:"What is the smallest runnable example or command that reproduces this?",
  platform:"Which operating system are you using?", terminal:"In which terminal or notebook does it happen?"};
const rows={};
for(const [id,{title,body}] of Object.entries(JSON.parse(readFileSync(input,"utf8")))) {
  const text=(title+"\n"+body).replace(/<!--[\s\S]*?-->/g," ").replace(/Provide a minimal code example[^\n]*|What platform \(Win\/Linux\/Mac\)[^\n]*|If you're using Rich in a terminal[^\n]*|If you're using Rich in a Jupyter Notebook[^\n]*/gi,"");
  const flags={repro:/\b(from rich[.\s]|import rich\b|python(?:3)?\s+-c\s|console\.print\s*\(|Traceback \(most recent call last\))/i.test(text),
    platform:/\b(windows(?: 10| 11)?|ubuntu|debian|macos|os x|linux|darwin|arch linux)\b/i.test(text),
    visual:/\b(colou?r|render(?:s|ed|ing)?|display|width|wrap(?:ped|ping)?|align(?:ment)?|glyph|flicker|terminal)\b/i.test(text),
    terminal:/\b(iterm2?|windows terminal|powershell|xterm|gnome terminal|jupyter|konsole|alacritty|kitty|vscode|vs code|cmd\.exe)\b/i.test(text)};
  const records=Object.entries(flags).filter(([k,v])=>k==="visual"||v).map(([k,v])=>({subject:"issue",at:1,recorded:1,source:"report."+k,by:"reader",value:v}));
  const result=decide(rules,{subject:"issue",at:1,asOf:1,records}).triage;
  const missing=new Set((result.needs??[]).map(n=>n.fact));
  const first=["repro","platform","terminal"].find(k=>missing.has(k));
  rows[id]={answer:result.status==="release"?"advance":"ask",field:first??null,question:prompts[first]??null};
}
writeFileSync(out,JSON.stringify(rows));
