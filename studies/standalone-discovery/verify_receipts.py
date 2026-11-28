"""Independent Python check of structured admission, plus what the author revealed after the cutoff."""
import json
import sys
from collections import Counter
from pathlib import Path


def main(root, split, service, method):
    data=Path(root);folder=Path(split)
    read=lambda name:json.loads((folder/name).read_text())
    schema=json.loads((data/"schema.json").read_text())
    fields=next(i["required_slots"] for s in schema if s["service_name"]==service for i in s["intents"] if i["name"]==method)
    reports=read("replayed.json")["results"];past=read("past.json"); consent=read("consent-oracle.json")
    queries=read("oracle.json"); counts=Counter()
    for k,r in past.items():
        missing={f for f in fields if not r["known"].get(f)}
        valid={"user.AFFIRM","previous.CONFIRM"}.issubset(r["seen"]) and not {"user.INFORM","user.NEGATE"}.intersection(r["seen"])
        ref=reports[k]["receiver"]
        assert ref["ready"] == (not missing and valid)
        assert set(ref["asks"]) == (missing or (set() if valid else {"approval"}))
        counts["matched_structured_records"]+=1
    for p in sorted((data/"heldout").glob("dialogues_*.json")):
        for d in json.loads(p.read_text()):
            turns=d["turns"]
            for i in range(0,len(turns)-2,2):
                k=d["dialogue_id"]+"/"+str(i)
                if k not in past:continue
                turn=next((f for f in turns[i+2]["frames"] if f["service"]==service),{})
                acts=turn.get("actions",[])
                if consent.get(k)=="confirm":
                    counts["assent_after_question"]+=any(a["act"]=="AFFIRM" for a in acts)
                    counts["refusal_after_question"]+=any(a["act"]=="NEGATE" for a in acts)
                if k in queries and queries[k]["ask"]:
                    answers={a["slot"] for a in acts if a["act"]=="INFORM" and a.get("values")}
                    counts["named_value_in_next_reply"]+=bool(answers.intersection(queries[k]["ask"]))
    print(json.dumps(counts,sort_keys=True))


if __name__=="__main__":main(*sys.argv[1:])
