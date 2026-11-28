"""Experimental transcript reader, separate from the Phaseline rule checker."""
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import sys
from raw_reader import features


def vector(turns):
    x=features(turns)
    # Keep explicit utterance boundaries when learning what the customer just answered.
    for j,(speaker,words) in enumerate(turns[-2:]):
        for k,v in features([(speaker,words)]).items():x[f"tail{len(turns[-2:])-j}:"+k]+=v
    norm=math.sqrt(sum(v*v for v in x.values())) or 1
    return {k:v/norm for k,v in x.items()}

def run(training, cases, output):
    train=json.loads(Path(training).read_text()); test=json.loads(Path(cases).read_text())
    examples=[(k,vector(r["text"]),{"slot."+s for s,v in r["known"].items() if v} | set(r["seen"])) for k,r in sorted(train.items())]
    labels=sorted({y for _,_,ys in examples for y in ys if y.startswith("slot.") or y in ("user.AFFIRM","previous.CONFIRM","user.INFORM","user.NEGATE")})
    # Same training examples, epochs and thresholds for every slot and both input splits.
    weights={l:defaultdict(float) for l in labels};bias=Counter()
    for _ in range(14):
        for _,vec,truth in examples:
            for label in labels:
                w=weights[label]
                z=bias[label]+sum(w.get(k,0)*v for k,v in vec.items())
                delta=0.4*((label in truth)-1/(1+math.exp(-max(-40,min(40,z)))))
                bias[label]+=delta
                for k,v in vec.items():w[k]+=delta*v
    predicted={}
    for k,r in test.items():
        v=vector(r["text"])
        predicted[k]=[l for l in labels if bias[l]+sum(weights[l].get(f,0)*w for f,w in v.items())>=0]
    Path(output).write_text(json.dumps(predicted,sort_keys=True))
if __name__=="__main__":run(*sys.argv[1:])
