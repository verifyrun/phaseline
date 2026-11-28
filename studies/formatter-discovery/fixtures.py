"""Isolate the checkout inputs from the formatter's held-back modes and expected bytes."""
import hashlib
import json
from pathlib import Path
import sys

root, out = map(Path, sys.argv[1:])
allowed = {"": [False]*3, "--skip-string-normalization": [True,False,False],
           "--skip-magic-trailing-comma": [False,True,False], "--line-length 80": [False,False,True]}
counts = dict.fromkeys(allowed,0)
briefs, gold = {}, {}
for path in sorted((root/"tests/data/cases").glob("*.py"), key=lambda p: hashlib.sha256(p.name.encode()).digest()):
    lines = path.read_text().splitlines(keepends=True)
    flags = lines.pop(0)[len("# flags: "):].strip() if lines and lines[0].startswith("# flags: ") else ""
    if flags not in allowed or counts[flags]>=16: continue
    lines = [line.replace("# EMPTY LINE WITH WHITESPACE (this comment will be removed)", "") for line in lines]
    split = next((i for i,line in enumerate(lines) if line.rstrip()=="# output"), len(lines))
    src = "".join(lines[:split]).strip()+"\n"
    expected = "".join(lines[split+1:]).strip()+"\n" if split<len(lines) else src
    if len(src.encode())>5000: continue
    key = hashlib.sha256(path.name.encode()).hexdigest()[:16]
    briefs[key]=src
    gold[key]={"name":path.name, "settings":allowed[flags], "expected":expected}
    counts[flags]+=1
for name,obj in [("fixtures",briefs),("fixture-key",gold)]:
    (out/(name+".json")).write_text(json.dumps(obj,sort_keys=True))
print("Enrolled",len(briefs),"upstream formatter fixtures")
