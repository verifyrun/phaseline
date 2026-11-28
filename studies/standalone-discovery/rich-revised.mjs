// Reports can establish a symptom from an artifact, an example, or a concrete reference.
// This consumer infers evidence presence; the maintainer still decides what to do.
import {diagnostic} from "./report-diagnostic.mjs";
import {decide} from "@verifyrun/phaseline";
import {readFileSync,writeFileSync} from "node:fs";
const [input,out]=process.argv.slice(2);
const prompts={html:"Can you share the generated HTML that displays incorrectly?",
  terminal:"Which terminal or notebook shows the problem?",repro:"What is the smallest runnable example or command that reproduces this?"};
const rules=[
  ...["html_path","terminal_path","html","terminal","repro","artifact","trigger"].map(k=>"fact "+k+" from report."+k+" owner reader"),
  "guarantee triage when (html_path and html) or (not html_path and (repro or (artifact and trigger) or (terminal_path and terminal and artifact)))"
].join("\n");
const answers={};
for(const [id,{title,body}] of Object.entries(JSON.parse(readFileSync(input,"utf8")))) {
  const cleaned=body.replace(/<!--[\s\S]*?-->/g," ").split(/I may ask you to copy and paste the output of the following commands/i)[0]
    .replace(/^(?:Provide a minimal code example|Please ensure that your example|If the issue is visual|What platform \(Win\/Linux\/Mac\)|- \[.{0,1}\] I['’](?:ve|m) checked).*$/gim,"");
  const text=title+"\n"+cleaned;
  const unresolved=diagnostic(title,cleaned);
  if (unresolved) {
    const [field,question]=unresolved;
    answers[id]={answer:"ask",field,question};
    continue;
  }
  // A feature proposal can go to triage with a stated goal. Defect reproduction is a different action.
  if (/^\[request\]/i.test(title) && cleaned.trim().length>20) {
    answers[id]={answer:"advance",field:null,question:null};
    continue;
  }
  const blocks=[...cleaned.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m=>m[1]);
  const html_path=/\b(?:html|browser|webpage)\b/i.test(title);
  const terminal_path=/\b(?:terminal|display|progress bar|colou?r|flicker|encoding)\b/i.test(text);
  const flags={html_path,terminal_path,
    html:/<(?:!doctype html|html|table|pre|div|span)\b/i.test(cleaned.replace(/<details>[\s\S]*?<\/details>/gi,"")) || /https?:\/\/\S+\.html\b/.test(cleaned),
    terminal:/\b(?:xterm|iterm2?|powershell|windows terminal|gnome terminal|jupyter|konsole|alacritty|kitty|mintty|vscode|vs code|cmd\.exe)\b/i.test(cleaned),
    repro:blocks.some(b=>/(?:^|\n)\s*(?:from rich\b|import rich\b|python(?:3)?\s+-[cm]\s|from \w+ import|console\s*=\s*Console\()/im.test(b))
      || /(?:^|\n)\s*(?:python|python3)\s+-c\s/im.test(cleaned),
    artifact:/!\[[^\]]*\]\(|<img\b|https?:\/\/user-images\.githubusercontent|Traceback \(most recent call last\)/i.test(cleaned)
      || blocks.some(b=>b.trim().length>25),
    trigger:/`[^`\n]{2,80}`|\b(?:CJK|unicode|yaml|json|ThreadPoolExecutor|wrapping|nested|long string)\b/i.test(text)};
  const records=Object.entries(flags).filter(([k,v])=>k.endsWith("_path")||v).map(([k,v])=>({subject:"issue",at:1,recorded:1,source:"report."+k,by:"reader",value:v}));
  const result=decide(rules,{subject:"issue",at:1,asOf:1,records}).triage;
  const needs=new Set((result.needs??[]).map(n=>n.fact));
  const first=html_path && needs.has("html")?"html": terminal_path && needs.has("terminal")?"terminal":"repro";
  answers[id]=result.status==="release"?{answer:"advance",field:null,question:null}:{answer:"ask",field:first,question:prompts[first]};
}
writeFileSync(out,JSON.stringify(answers));
