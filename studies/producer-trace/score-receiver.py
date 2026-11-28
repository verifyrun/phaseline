"""Open the route key only after saved first actions exist. Compare the second host process too."""
import hashlib
import json
from pathlib import Path
import sys

work, replay = map(Path, sys.argv[1:])
study = Path(__file__).resolve().parent
def load(path):
    return json.loads(path.read_text())

results = {}
for version, edition in [("10.4.0", "v1"), ("11.0.0", "v2")]:
    host = "host-" + version
    obs = load(work / host / "observations.json")
    routes = load(work / host / "examiner.json")
    other = load(replay / host / "observations.json")
    first = load(study / ("first-" + edition + ".json"))
    assert set(obs) == set(routes) == set(other) == set(first)
    identities = {
        "bundled": ("esbenp.prettier-vscode", f"esbenp.prettier-vscode@{version}/bundled-prettier@2.8.8"),
        "same-release": ("esbenp.prettier-vscode", "engine-2.8.8/node_modules/prettier@2.8.8"),
        "new-release": ("esbenp.prettier-vscode", "engine-3.3.3/node_modules/prettier@3.3.3"),
        "builtin": ("vscode.typescript-language-features", "vscode/bundled-tsserver@6.0.3"),
    }
    counts = dict(changed=0, accurately_traced=0, required=0, right=0, early=0, actionable=0, needless=0, wrong_ready=0, replay_matches=0)
    rows = {}
    for name, case in obs.items():
        changed = case["before"] != case["after"]
        tool, installation = identities[routes[name]]
        counts["changed"] += changed
        counts["replay_matches"] += int(other[name] == case)
        for view, ans in first[name].items():
            required = changed and view != "logs"
            asks = ans["status"] in ("hold","ask")
            if required:
                counts["required"] += 1
                expected = "installation" if view == "tool_only" else "tool"
                counts["right"] += ans.get("field") == expected and ans["status"] == "ask" and ans["step"] == 1 and (view != "tool_only" or ans.get("tool") == tool)
                counts["early"] += not asks
            else:
                counts["actionable"] += 1
                counts["needless"] += asks
                correct = ans["status"] == "preexisting" if not changed else (ans["status"] == "traced" and ans.get("step") == 1 and (ans.get("tool"),ans.get("installation")) == (tool,installation))
                counts["wrong_ready"] += not correct and not asks
                counts["accurately_traced"] += changed and correct
        rows[name] = dict(route=routes[name], changed=changed, replay=other[name]==case,
                          before_sha256=hashlib.sha256(case["before"].encode()).hexdigest(),
                          after_sha256=hashlib.sha256(case["after"].encode()).hexdigest())
    results[edition] = dict(counts=counts, cases=rows)
    print(edition, counts)
(work / "receiver-results.json").write_text(json.dumps(results, indent=2) + "\n")
