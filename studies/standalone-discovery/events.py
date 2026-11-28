"""Before-cutoff event evidence; scorer alone sees the subsequent response."""
import json
import sys
from pathlib import Path
from collections import Counter


def frames(turn):
    return {f["service"]: f for f in turn["frames"]}


def actions(frame):
    return {a["act"] for a in frame.get("actions", [])}


def events(previous, user):
    return sorted(["previous." + v for v in actions(previous)] + ["user." + v for v in actions(user)])


def run(directory, schema, output, learn, target=("Hotels_4","ReserveHotel")):
    transactional = {(s["service_name"], intent["name"]) for s in schema for intent in s["intents"]
                     if intent["is_transactional"]}
    training, visible, oracle, domains = [], {}, {}, Counter()
    for path in sorted(directory.glob("dialogues_*.json")):
        for d in json.loads(path.read_text()):
            turns = d["turns"]
            for j in range(0,len(turns)-1,2):
                user=turns[j]; nxt=turns[j+1]
                assert user["speaker"]=="USER" and nxt["speaker"]=="SYSTEM"
                prev=frames(turns[j-1]) if j else {}
                for service,f in frames(user).items():
                    intent=f["state"]["active_intent"]
                    if (service,intent) not in transactional:continue
                    sysframe=frames(nxt).get(service,{})
                    old=prev.get(service,{})
                    features=events(old,f)
                    called=sysframe.get("service_call",{}).get("method")==intent
                    confirmed="CONFIRM" in actions(sysframe) and "REQUEST" not in actions(sysframe) and not sysframe.get("service_call")
                    if not service.startswith("Hotels_"):
                        if learn and (called or confirmed):
                            training.append({"seen":features,"acted":called})
                            domains[service]+=1
                        continue
                    if (service,intent)!=target:continue
                    key=str(d["dialogue_id"])+"/"+str(j)
                    # Visible current state and previous actual proposal, never the next turn.
                    visible[key]={"seen":features, "known":f["state"]["slot_values"],
                                  "previousTerms":{a["slot"]:a["values"] for a in old.get("actions",[]) if a["act"]=="CONFIRM"},
                                  "text":[[t["speaker"],t["utterance"]] for t in turns[:j+1]]}
                    if called or confirmed:
                        assert not (called and confirmed)
                        oracle[key]="call" if called else "confirm"
    for name,data in [("past",visible),("consent-oracle",oracle)]:
        (output/(name+".json")).write_text(json.dumps(data,sort_keys=True))
    if learn:
        (output/"other-projects.json").write_text(json.dumps(training))
        print(len(training),len(domains),dict(domains))

if __name__=="__main__":
    run(Path(sys.argv[1]),json.loads(Path(sys.argv[2]).read_text()),Path(sys.argv[3]),"train" in sys.argv[4:],
        ("Hotels_2","BookHouse") if "house" in sys.argv[4:] else ("Hotels_4","ReserveHotel"))
