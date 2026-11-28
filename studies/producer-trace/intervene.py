"""Reuse the sealed v2 input bytes, changing only the selected formatter in the isolated workspace."""
import json
from pathlib import Path
import sys

root, original = map(Path,sys.argv[1:])
work = root/"product"
version = "11.0.0"
routes = json.loads((original/("host-"+version)/"examiner.json").read_text())
old = json.loads((original/("host-"+version)/"observations.json").read_text())
for name, route in routes.items():
    (work/name/"sample.js").write_text(old[name]["before"])
    replacement = "esbenp.prettier-vscode" if route == "builtin" else "vscode.typescript-language-features"
    (work/name/".vscode/settings.json").write_text(json.dumps({"[javascript]":{"editor.defaultFormatter":replacement}}))
