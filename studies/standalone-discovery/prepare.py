"""Split independently authored conversations into prior evidence and the next-turn oracle."""
import argparse
import json
from collections import Counter
from pathlib import Path


def run(directory, out):
    evidence, gold, stats = [], {}, Counter()
    for path in sorted(directory.glob("dialogues_*.json")):
        for dialog in json.loads(path.read_text()):
            turns = dialog["turns"]
            prefix = []
            for i, turn in enumerate(turns[:-1]):
                prefix.append([turn["speaker"], turn["utterance"]])
                user = next((f for f in turn["frames"] if f["service"] == "Hotels_4"), None)
                if turn["speaker"] != "USER" or not user or user["state"]["active_intent"] != "ReserveHotel":
                    continue
                system = next((f for f in turns[i+1]["frames"] if f["service"] == "Hotels_4"), {})
                asks = sorted({a["slot"] for a in system.get("actions", []) if a["act"] == "REQUEST" and a["slot"]})
                call = system.get("service_call", {})
                called = call.get("method") == "ReserveHotel"
                if turns[i+1]["speaker"] != "SYSTEM" or bool(asks) == called:
                    stats["mixed" if asks and called else "other"] += 1
                    continue
                key = f'{dialog["dialogue_id"]}/{i}'
                assert key not in gold
                evidence.append({"id": key, "known": user["state"]["slot_values"], "text": list(prefix)})
                gold[key] = {"ask": asks, "call": call["parameters"] if called else None}
    out.mkdir(parents=True, exist_ok=True)
    for name, data in [("inputs", evidence), ("oracle", gold), ("exclusions", dict(stats))]:
        (out / (name + ".json")).write_text(json.dumps(data, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    run(args.directory, args.output)
