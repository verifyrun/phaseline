"""Run with Python 3.10+, python-dotenv installed, and the Phaseline CLI on PATH."""
from io import StringIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

from dotenv import load_dotenv
from probe import inquiry, measure


def load_label(config):
    with patch.object(os, "environ", config):
        load_dotenv(stream=StringIO("LABEL=coffee\n"), override=True, interpolate=False)
    return config.values_now.get("LABEL") == "coffee"


def analyze(cli, known, allow_test_reads):
    keys, rows, runs = measure(load_label, known)
    # The test operator authorizes all discovered synthetic keys for the positive control.
    rules, observer, histories, names = inquiry(keys, rows, keys if allow_test_reads else [])
    with TemporaryDirectory() as tmp:
        files = [Path(tmp, n) for n in ("decision.phase", "observer.phase", "histories.json")]
        for f, data in zip(files, (rules, observer, json.dumps(histories))):
            f.write_text(data, encoding="utf-8")
        call = subprocess.run([*cli, "analyze", *files], text=True, capture_output=True, check=True)
    cell = json.loads(call.stdout)["cells"][0]
    first = cell.get("firstObservation", {}).get("fact")
    return {"status": cell["status"], "answer": cell.get("answer"), "ask": names.get(first),
            "reads_seen": keys, "runs": runs, "scope": "sampled_local_configurations"}


if __name__ == "__main__":
    # Passing node and the installed JS entry separately also works on Windows.
    cli = sys.argv[1:] or ["phaseline"]
    for label in (None, "coffee"):
        for allow in (True, False):
            print(json.dumps({"initial_label": label, "receiver_read_allowed": allow,
                              **analyze(cli, {"LABEL": label}, allow)}))
