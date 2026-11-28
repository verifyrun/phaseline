"""Small text-only comparison: closest prior user conversation by TF-IDF cosine."""
import collections
import json
import math
import re
import sys
from pathlib import Path


def features(turns):
    bag = collections.Counter()
    for i,(speaker, text) in enumerate(turns):
        words = re.findall(r"[a-z]+|[0-9]+", text.lower())
        for token in words + [" ".join(pair) for pair in zip(words, words[1:])]:
            bag[speaker + ":" + token] += 1
            if i == len(turns)-1:
                bag["last:" + token] += 1
    return bag


def main(train_file, input_file, output):
    train = json.loads(Path(train_file).read_text())
    bags = [features(r["text"]) for r in train]
    df = collections.Counter(k for b in bags for k in b)
    def normalized(b):
        weights = {k: (1 + math.log(n)) * (1 + math.log((1+len(train))/(1+df[k]))) for k,n in b.items()}
        norm = math.sqrt(sum(w*w for w in weights.values())) or 1
        return {k: w/norm for k,w in weights.items()}
    vectors = [normalized(b) for b in bags]
    predictions = {}
    for r in json.loads(Path(input_file).read_text()):
        query = normalized(features(r["text"]))
        eligible = [i for i, t in enumerate(train) if t["id"].split("/")[0] != r["id"].split("/")[0]]
        best = max(eligible, key=lambda i: sum(w*vectors[i].get(k,0) for k,w in query.items()))
        predictions[r["id"]] = sorted(k for k,v in train[best]["known"].items() if v)
    Path(output).write_text(json.dumps(predictions, sort_keys=True))


if __name__ == "__main__":
    main(*sys.argv[1:])
