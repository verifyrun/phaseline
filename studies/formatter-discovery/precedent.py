"""Before advancing on a report, look for a specific diagnostic from an earlier project report."""
from collections import Counter
from collections.abc import Iterable
import json
from math import log, sqrt
from pathlib import Path
import re
import sys

STOP = set("the a an my what when for to this and o with it you how from black rich describe bug expected behavior reproduce version python output following code example that on is in of using not does can would by file run platform environment additional context terminal information minimal please operating system if arguments should these but then".split())

def terms(text):
    text = re.sub(r"<!--.*?-->|https?://\S+", " ", text.lower(), flags=re.S)
    return [t for t in re.findall(r"[a-z][a-z0-9_-]+",text) if t not in STOP]

def features(report):
    # Titles and the author's initial description carry more signal than a repeated issue template.
    short = re.split(r"\*\*(?:to reproduce|platform|environment)|\n```",report["body"],maxsplit=1,flags=re.I)[0]
    return Counter(terms(report["title"])*3+terms(short[:1400])+terms(report["body"][:2200]))

def predict(train, test):
    docs = [features(row) for row in train]
    df = Counter(term for doc in docs for term in doc)
    def vector(doc):
        return {k:(1+log(v))*log(1+(len(docs)+1)/(1+df[k])) for k,v in doc.items()}
    def norm(x): return sqrt(sum(v*v for v in x.values()))
    bank = [vector(doc) for doc in docs]
    answers={}
    for key,report in test.items():
        q=vector(features(report))
        scores=[sum(v*q.get(k,0) for k,v in d.items())/(norm(q)*norm(d) or 1) for d in bank]
        idx=max(range(len(scores)), key=scores.__getitem__)
        best=train[idx]
        use=bool(best["question"]) and scores[idx]>=0.30
        answers[key]={"precedent":best["issue"],"similarity":round(scores[idx],3),"question":best["question"] if use else None}
    return answers

if __name__=="__main__":
    train,test,out=map(Path,sys.argv[1:])
    out.write_text(json.dumps(predict(json.loads(train.read_text()),json.loads(test.read_text())),indent=2,sort_keys=True)+"\n")
