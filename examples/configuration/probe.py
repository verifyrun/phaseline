"""Find configuration reads of a trusted local operation and replay finite settings.

The callback receives an isolated mapping. It must start fresh on every invocation,
return a Boolean outcome and confine side effects to the fixture. This example
does not intercept filesystem, network or process access in arbitrary programs.
"""
from collections.abc import MutableMapping
from itertools import product


class Unmeasured(Exception):
    """The experiment cannot support a decision within the supplied scope."""


class Configuration(MutableMapping):
    def __init__(self, initial):
        self.values_now = dict(initial)
        self.read = set()

    def __getitem__(self, key):
        if not isinstance(key, str):
            raise ValueError("Configuration keys must be strings")
        self.read.add(key)
        return self.values_now[key]

    def __setitem__(self, key, value):
        self.values_now[key] = value

    def __delitem__(self, key):
        del self.values_now[key]

    def __iter__(self):
        raise Unmeasured("Enumeration requires a separately specified complete key set")

    def __len__(self):
        raise Unmeasured("Counting keys requires a separately specified complete key set")


def measure(operation, known, options=(None, "0", "1"), limit=128):
    """None represents absence. Known keys stay fixed, even when absent."""
    if not options or any(v is not None and not isinstance(v, str) for v in options):
        raise ValueError("Use distinct strings or None as configuration alternatives")
    if len(set(options)) != len(options) or not 1 <= limit <= 128:
        raise ValueError("Use distinct alternatives and a run limit of 1 to 128")
    keys, rows, runs = [], [], 0
    while True:
        combinations = len(options) ** len(keys)
        if runs + 2 * combinations > limit:
            raise Unmeasured(f"Experiment exceeds {limit} runs")
        rows.clear()
        discovered = set()
        for indices in product(range(len(options)), repeat=len(keys)):
            inputs = {**known, **{k: options[i] for k, i in zip(keys, indices)}}
            observations = []
            for _ in range(2):
                config = Configuration({k: v for k, v in inputs.items() if v is not None})
                outcome = operation(config)
                if type(outcome) is not bool:
                    raise ValueError("Supply a Boolean observation of the destination")
                observations.append((config.read, outcome))
            if observations[0] != observations[1]:
                raise Unmeasured("Repeating the same fixture changed the reads or destination")
            reads, outcome = observations[0]
            discovered.update(reads.difference(known, keys))
            rows.append((indices, outcome))
        runs += 2 * combinations
        if not discovered:
            return keys, rows, runs
        keys = sorted({*keys, *discovered})


def inquiry(keys, rows, readable, budget=1):
    """Only a separately authorized receiver read may become a proposed question."""
    fields = [f"key{i}" for i in range(len(keys))]
    bindings = [f"fact {f} in units from config.{f} owner receiver missing hold_dependents"
                for f in fields]
    rules = "\n".join([*bindings, "fact outcome from probe.result owner examiner missing hold_dependents",
                        "guarantee delivered when outcome"])
    offers = [f"offer {f} cost 1" for k, f in zip(keys, fields) if k in readable]
    observer = "\n".join(["question delivered", "observe none", *offers, f"budget {budget}"])
    histories = [{"id": f"run{i}", "facts": {**dict(zip(fields, values)), "outcome": answer}}
                 for i, (values, answer) in enumerate(rows)]
    return rules, observer, {"histories": histories}, dict(zip(fields, keys))
