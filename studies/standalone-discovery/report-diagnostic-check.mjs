import assert from "node:assert/strict";
import {diagnostic} from "./report-diagnostic.mjs";
for (const [title,body,field] of [
  ["unexpected builtin","from rich import traceback","import_origin"],
  ["wrapping line numbers","RichHandler","observed_width"],
  ["Markdown ordered incorrectly","code after the list","list_boundary"],
  ["test runner fails","TERM=unknown","terminal_contract"],
  ["Markdown ordered incorrectly","I tried an extra blank line after the list",null],
  ["wrap line numbers","resizing the terminal changes the result",null],
  ["Add a progress spinner","Example included",null],
]) assert.equal(diagnostic(title,body)?.[0]??null,field);
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const dir=mkdtempSync(join(tmpdir(),"report-action-"));
try {
  const input=join(dir,"reports.json"),out=join(dir,"answers.json");
  writeFileSync(input,JSON.stringify({
    bug:{title:"Markdown ordering",body:"An indented block changes order after a list.\n```python\nimport rich\n```"},
    paired:{title:"Links wrap",body:"A long link breaks with `rich.print`. The native `print` works."},
    feature:{title:"[REQUEST] Force ANSI",body:"A team wants an environment variable to force ANSI output."},
  }));
  execFileSync(process.execPath,[fileURLToPath(new URL("./rich-revised.mjs",import.meta.url)),input,out]);
  const result=JSON.parse(readFileSync(out));
  assert.equal(result.bug.field,"list_boundary");
  assert.equal(result.paired.answer,"advance");
  assert.equal(result.feature.answer,"advance");
} finally {rmSync(dir,{recursive:true,force:true});}
