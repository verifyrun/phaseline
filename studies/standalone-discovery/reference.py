"""Independent exhaustive Python comparison on the same observable features."""
from itertools import combinations
import json
import sys


def best(rows):
    rows=[(set(r["seen"]),r["acted"]) for r in rows]
    features=sorted(set().union(*(s for s,_ in rows)))
    positives=sum(y for _,y in rows);negatives=len(rows)-positives
    scores=[]
    for width in (1,2):
        for names in combinations(features,width):
            group=set(names)
            tp=sum(y and group<=s for s,y in rows);fp=sum(not y and group<=s for s,y in rows)
            scores.append((-(tp*negatives-fp*positives),width,names,tp,fp))
    _,_,names,tp,fp=min(scores)
    return list(names),tp,fp

if __name__=="__main__":
    with open(sys.argv[1]) as f: data=json.load(f)
    print(json.dumps(best(data)))
