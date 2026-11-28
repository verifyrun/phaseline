"""Independent receiver after first decisions have been sealed; runs the native CLI for both editions."""
import hashlib
from itertools import product
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

fields=["skipStringNormalization","skipMagicTrailingComma","lineLength80"]
run_dir, first, out=map(Path,sys.argv[1:])
inputs=json.loads((run_dir/"fixtures.json").read_text())
key=json.loads((run_dir/"fixture-key.json").read_text())
answers=json.loads(first.read_text())
digest=lambda text:hashlib.sha256(text.encode()).hexdigest()
report={}
for ver,cases in answers.items():
    measured=json.loads((run_dir/(ver+".json")).read_text())["results"]
    results={}
    for k,case in cases.items():
        cfg=key[k]["settings"]
        lookup=measured[k]
        flags=[arg for enabled,args in zip(cfg,[["--skip-string-normalization"],["--skip-magic-trailing-comma"],["--line-length","80"]]) if enabled for arg in args]
        with TemporaryDirectory() as tmp:
            p=subprocess.run([str(run_dir/ver/"bin/black"),"--quiet","--config",str(run_dir/"black/tests/data/empty_pyproject.toml"),*flags,"-"],input=inputs[k],text=True,capture_output=True,cwd=tmp)
        if p.returncode or any(not isinstance(v,str) for v in lookup):
            results[k]={"name":key[k]["name"],"error":p.stderr[:150] if p.returncode else "unmeasured grid","decision":case}
            continue
        same=[v==lookup[0] for v in lookup]
        tree=case["tree"]
        ask=[]
        remaining=list(range(8))
        useful=True
        while "ask" in tree:
            field=fields.index(tree["ask"])
            flip=1<<(2-field)
            useful &= any((i^flip) in remaining and same[i]!=same[i^flip] for i in remaining)
            ask.append(fields[field])
            remaining=[i for i in remaining if bool(i & flip) == cfg[field]]
            tree=tree["answers"][int(cfg[field])]
        # An early answer also fails if a still-compatible alternative would have changed it.
        early=any("matches" in tree and tree["matches"]!=same[i] for i in remaining)
        actual=p.stdout==lookup[0]
        results[k]={"name":key[k]["name"],"ambiguous":len(set(same))>1,"questions":ask,
                    "useful":bool(ask) and useful,"needless":bool(ask or "hold" in tree) and len(set(same))==1,
                    "premature":early,"held":"hold" in tree,"actual":actual,
                    "correct":tree.get("matches")==actual,"destination":digest(p.stdout),
                    "gold":p.stdout==key[k]["expected"],"candidate":case["candidate"]}
    report[ver]=results
out.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
for v,data in report.items():
    print(v, {k:sum(x.get(k,False) for x in data.values()) for k in ("ambiguous","useful","needless","premature","correct","held","gold")}, "errors",sum("error" in x for x in data.values()))
vs=list(report)
good=[k for k in report[vs[0]] if all("error" not in report[v][k] for v in vs)]
print("changed destinations",sum(report[vs[0]][k]["destination"]!=report[vs[1]][k]["destination"] for k in good),"stale verdicts",sum(report[vs[0]][k]["actual"]!=report[vs[1]][k]["actual"] for k in good))
