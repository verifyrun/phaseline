"""This process only sees source text as formatter input. It never executes it."""
from itertools import product
import json
from pathlib import Path
import sys
import black

inputs = json.loads(Path(sys.argv[1]).read_text())
results = {}
for key,source in inputs.items():
    rows = []
    for strings, commas, width in product((False,True), repeat=3):
        mode = black.Mode(string_normalization=not strings,magic_trailing_comma=not commas,line_length=80 if width else 88)
        try:
            rows.append(black.format_file_contents(source, fast=False, mode=mode))
        except black.NothingChanged:
            rows.append(source)
        except Exception as e:
            rows.append({"error":type(e).__name__})
    results[key] = rows
Path(sys.argv[2]).write_text(json.dumps({"version":black.__version__,"results":results},sort_keys=True))
