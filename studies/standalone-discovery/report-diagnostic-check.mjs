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
