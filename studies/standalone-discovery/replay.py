"""Run against clean RC55 and RC56 npm consumers. See results.md for preparation."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
BASE = "https://raw.githubusercontent.com/google-research-datasets/dstc8-schema-guided-dialogue/e852981ae34990f4358979625854259302feaa78/test"
def call(args, **kw):
    return subprocess.run([str(a) for a in args],check=True,**kw)
def main(root,old,new):
    root.mkdir(parents=True,exist_ok=True)
    for name in ("diagnosis","heldout","dx","checked","house-train","house-test","baseline","candidate"):
        (root/name).mkdir(exist_ok=True)
    def fetch(pair):
        url,path=pair
        if not path.exists():
            call(["curl","-fsSL","--retry","2",url,"-o",path.with_suffix(".part")])
            path.with_suffix(".part").rename(path)
    files=[(BASE+"/schema.json",root/"schema.json")]
    for i in range(1,35):
        name=f"dialogues_{i:03}.json"
        files.append((BASE+"/"+name,root/("diagnosis" if i<=17 else "heldout")/name))
    with ThreadPoolExecutor(4) as pool:list(pool.map(fetch,files))
    for directory,archive,script in [("baseline",old,"predict.mjs"),("candidate",new,"receiver.mjs")]:
        consumer=root/directory
        (consumer/"package.json").write_text('{"private":true,"type":"module"}')
        call(["npm","install","--ignore-scripts","--no-fund","--no-audit",archive],cwd=consumer)
        shutil.copy(HERE/script,consumer/script)
    def py(script,*args,**kw):return call([sys.executable,HERE/(script+".py"),*args],cwd=root,**kw)
    def load(path): return json.loads((root/path).read_text())
    def dump(path,obj): (root/path).write_text(json.dumps(obj,sort_keys=True))
    for a,b,house in [("dx","checked",False),("house-train","house-test",True)]:
        for split,directory in [(a,"diagnosis"),(b,"heldout")]:
            py("events",directory,"schema.json",split,*(["house"] if house else []),*(["train"] if split=="dx" else []))
            py("prepare",directory,split,*(["--house"] if house else []))
        dump(b+"/raw-past.json",{k:{"text":r["text"]} for k,r in load(b+"/past.json").items()})
        py("learned_reader",a+"/past.json",b+"/raw-past.json",b+"/learned.json")
        if not house:
            dump(b+"/raw-visible.json",[{k:r[k] for k in ("id","text")} for r in load(b+"/inputs.json")])
            py("raw_reader",a+"/inputs.json",b+"/raw-visible.json",b+"/raw.json")
            call(["node","baseline/predict.mjs","schema.json",b+"/inputs.json",b+"/raw.json",b+"/first.json"],cwd=root)
        service,action=("Hotels_2","BookHouse") if house else ("Hotels_4","ReserveHotel")
        call(["node","candidate/receiver.mjs","schema.json","dx/other-projects.json",b+"/past.json",
              b+"/learned.json",b+"/receiver.json",service,action],cwd=root)
        shutil.copy(root/b/"receiver.json",root/b/"replayed.json")
        py("verify_receipts",root,b,service,action)
        if not house:
            result=json.loads(py("consent_score",b,"schema.json",capture_output=True).stdout)
            expected=json.loads((HERE/"hotel-results.json").read_text())
            for section in ("fields","consent"):
                assert all(result[section][arm]==score for arm,score in expected[section].items())
        else:
            predictions=load(b+"/receiver.json")["results"];labels=load(b+"/consent-oracle.json")
            fields=load(b+"/oracle.json")
            for arm,expected in json.loads((HERE/"house-results.json").read_text()).items():
                stats={k:0 for k in expected}
                for k,kind in labels.items():
                    p=predictions[k][arm];stats[kind]+=1
                    if kind=="call":stats["needless_hold"]+=not p["ready"]
                    else:
                        stats["premature"]+=p["ready"];stats["correct_consent"]+=p["asks"]==["approval"]
                        stats["wrong_question"]+=bool(p["asks"] and p["asks"]!=["approval"])
                for k,r in fields.items():
                    if r["ask"]:
                        p=predictions[k][arm];stats["field_cases"]+=1;stats["field_premature"]+=p["ready"]
                        stats["first_field_right"]+=bool(p["asks"] and p["asks"][0] in r["ask"])
                assert stats==expected,(arm,stats,expected)
    print("All recorded hotel and house scores reproduced.")
if __name__=="__main__":
    parser=argparse.ArgumentParser()
    for arg in ("directory","rc55_archive","rc56_archive"):parser.add_argument(arg,type=Path)
    args=parser.parse_args()
    main(args.directory.resolve(),args.rc55_archive.resolve(),args.rc56_archive.resolve())
