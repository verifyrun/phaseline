"""Fail on a broken reader, a missing prediction, or a score without a corresponding first action."""
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
from reader import read

study = Path(__file__).resolve().parent
load = lambda name: json.loads((study/name).read_text())
for first, grades, expected in (
    ("blind-human.json","blind-grades.json",{"right question":1,"wrong question":5,"needless hold":6,"ready":1}),
    ("final-human.json","final-grades.json",{"right question":1,"wrong question":8,"needless hold":11,"mixed":4}),
):
    predictions = load(first)
    scored = load(grades)
    assert len(predictions) == len(scored)
    for number, case in scored.items():
        key = sha256(f"cold-producer-{number}".encode()).hexdigest()[:16]
        answer = predictions[key]
        assert answer.get("field",answer["action"]) == case["first"]
    assert Counter(c["grade"] for c in scored.values()) == expected

assert read({"title":"Process CPU high", "body":"Extension active; no log supplied."},"editor")["field"] == "process"
assert read({"title":"Bundle fallback","body":"Failed to load formatter from the project. Using bundled formatter."},"editor")["action"] == "advance"
assert read({"title":"AST changed", "body":"--- src\n+++ dst\nIs bug replicable on master?"},"black")["field"] == "revision"

# A link in an opening cannot authorize acquisition from a private repository.
from unittest.mock import patch
from manifests import retrieve
with patch("manifests.gh", return_value={"visibility":"private"}) as api:
    assert retrieve({"body":"https://github.com/example/hidden"}, "2020-01-01T00:00:00Z") == {}
    api.assert_called_once_with("repos/example/hidden")
