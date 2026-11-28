"""Score the source probe and the receiver's independent outcome on both releases."""
import json
from importlib.metadata import version
import sys
import unittest

from dotenv_demo import analyze, load_label
from probe import Configuration, measure, Unmeasured


class Discovery(unittest.TestCase):
    def test_branch_reveals_another_read(self):
        def both(settings):
            return settings.get("FIRST") == "1" and settings.get("SECOND") == "1"
        keys, rows, _ = measure(both, {})
        self.assertEqual(keys, ["FIRST", "SECOND"])
        self.assertEqual(sum(result for _, result in rows), 1)
        with self.assertRaises(Unmeasured):
            measure(both, {}, limit=4)
        with self.assertRaises(Unmeasured):
            measure(lambda settings: len(settings) == 0, {})

        alternating = iter((True, False))
        with self.assertRaises(Unmeasured):
            measure(lambda _: next(alternating), {})

    def test_actual_release(self):
        release = version("python-dotenv")
        self.assertIn(release, ("1.1.1", "1.2.0"))
        # The independent grading fixture can name the hidden setting. The reader above cannot.
        setting = "PYTHON_DOTENV_DISABLED"
        asks = needless = early = matched = denied = 0
        for initial in (None, "coffee", "tea"):
            known = {"LABEL": initial}
            allowed = analyze(CLI, known, True)
            forbidden = analyze(CLI, known, False)
            # Observe a fresh receiver, isolated from the search, for every candidate value.
            actual = []
            for value in (None, "0", "1"):
                fixture = {k: v for k, v in {**known, setting: value}.items() if v is not None}
                actual.append(load_label(Configuration(fixture)))
            varies = len(set(actual)) > 1
            self.assertEqual(varies, release == "1.2.0" and initial != "coffee")
            if allowed["status"] == "inquiry_available":
                asks += 1
                needless += not varies
                self.assertEqual(allowed["ask"], setting)
                self.assertEqual(forbidden["status"], "indistinguishable")
                denied += 1
                # Read the value and recompute the conditional forecast, then check the actual effect.
                for value, expected in zip((None, "0", "1"), actual):
                    settled = analyze(CLI, {**known, setting: value}, False)
                    self.assertEqual(settled["status"], "determined")
                    self.assertIs(settled["answer"], expected)
                    matched += 1
            else:
                early += varies
                self.assertEqual(allowed["status"], "determined")
                self.assertEqual(forbidden["status"], "determined")
                self.assertTrue(all(a is allowed["answer"] for a in actual))
                matched += len(actual)
        self.assertEqual((needless, early, matched), (0, 0, 9))
        self.assertEqual(asks, 2 if release == "1.2.0" else 0)
        print(json.dumps(dict(release=release, asked=asks, denied=denied, needless=needless,
                              early=early, verified_destination_outcomes=matched)))


if __name__ == "__main__":
    CLI = sys.argv[1:] or ["phaseline"]
    unittest.main(argv=[sys.argv[0]])
