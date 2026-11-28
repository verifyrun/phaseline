"""Open the future turn only after predictions have been written."""
import json
import sys
from collections import Counter,defaultdict
from pathlib import Path
def read(p):return json.loads(Path(p).read_text())
def score(gold, predictions, schema, inputs):
    required = next(i["required_slots"] for s in schema if s["service_name"]=="Hotels_4"
                    for i in s["intents"] if i["name"]=="ReserveHotel")
    stats=defaultdict(Counter)
    assert gold.keys()==predictions.keys()
    current={r["id"]:r["known"] for r in inputs}
    for key,truth in gold.items():
        known={k for k,v in current[key].items() if v}
        py=[k for k in required if k not in known]
        for arm,pred in {**predictions[key],"python":{"ready":not py,"asks":py}}.items():
            s=stats[arm]; ask=truth["ask"]; proposed=pred["asks"]
            if ask:
                s["ask_cases"]+=1
                s["optional_only"]+=not bool(set(required)&set(ask))
                s["first_right"]+=bool(proposed and proposed[0] in ask)
                s["any_right"]+=bool(set(proposed)&set(ask))
                s["wrong_first"]+=bool(proposed and proposed[0] not in ask)
                s["bare_hold"]+=not proposed and not pred["ready"]
                s["premature"]+=pred["ready"]
            else:
                s["call_cases"]+=1
                s["needless_hold"]+=not pred["ready"]
                s["ready"]+=pred["ready"]
                s["all_call_values_in_prior_state"]+=all(str(truth["call"].get(k)) in current[key].get(k,[]) for k in required)
    return stats
if __name__=="__main__":print(json.dumps(score(*(read(p) for p in sys.argv[1:])),indent=2))
