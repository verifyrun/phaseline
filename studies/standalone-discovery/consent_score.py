"""Score the original field questions and the separate confirmation test independently."""
import json
from collections import Counter,defaultdict
import sys
from pathlib import Path
from score import score
def read(path):return json.loads(Path(path).read_text())
def run(folder,schema):
    folder=Path(folder);r=read(folder/'receiver.json')["results"]; inputs=read(folder/'inputs.json')
    g=read(folder/'oracle.json'); labels=read(folder/'consent-oracle.json'); seen=read(folder/'past.json')
    merged=read(folder/'first.json')
    for k in g:merged[k].update(r[k])
    original=score(g,merged,read(schema),inputs)
    counts=defaultdict(Counter)
    for k,kind in labels.items():
        for arm,p in r[k].items():
            c=counts[arm]
            c[kind]+=1
            if kind=="call":
                c["ready"]+=p["ready"];c["needless_hold"]+=not p["ready"]
            else:
                c["correct_confirm"]+=p["asks"]==["approval"]
                c["wrong_question"]+=bool(p["asks"] and p["asks"]!=["approval"])
                c["premature"]+=p["ready"]
                c["bare_hold"]+=not p["ready"] and not p["asks"]
    assert all(c["confirm"]==c["correct_confirm"]+c["wrong_question"]+c["premature"]+c["bare_hold"] for c in counts.values())
    return {"fields":original,"consent":counts,"excluded_from_original":read(folder/'exclusions.json')}
if __name__=="__main__":print(json.dumps(run(*sys.argv[1:]),indent=2))
