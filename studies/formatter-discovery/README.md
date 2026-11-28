# Can a stranger discover the missing fact before acting?

The original Rich reader asked the right free-form question on 0/4 required cases and needlessly held 7/12 actionable cases. After inspecting those answers the repaired caller asked all four known questions and held 4/12 actionable reports. Those are regression results. The original blind grade stands. [Rich fix and all 16 outcomes](https://github.com/verifyrun/phaseline/blob/28a8ef3c5961c68d830ca607fe59c295625600c2/studies/standalone-discovery/rich-diagnostic-replay.json)

We used a different project, Black. Its maintainers and reporters supplied the archived prompts and later facts. The selector held their later messages separately, and each predictor's first action was committed before the replies were opened. The rounds were run and graded by the same operator. The controls are actionable for triage. No test authorized deploying a fix. [Rules frozen before selection](protocol.md) · [Human receipts and per-case scores](human-grades.json)

| Reader and untouched opening window | Right question / needed | Needless holds / actionable | Early advances / needed |
| --- | ---: | ---: | ---: |
| Prior Rich reader, early 2024 | 0/4 | 2/7 | 3/4 |
| Agent reading those openings | 0/4 | 2/7 | 2/4 |
| Similarity to 56 older Black threads | 0/4 | 0/7 | 4/4 |
| First formatter-specific repair, 2025 | 0/4 | 1/7 | 4/4 |
| Second repair, July–December 2024 | 0/7 | 0/5 | 7/7 |
| Final repair, 2021 | 0/5 | 1/7 | 5/5 |

The early-2024 Windows junction report is ambiguous and excluded from both denominators. The author confirmed a particular build fixed it, with no direct answer to whether Windows junction semantics were the cause. The first and second repairs could answer the preceding training sets at 4/4 with 2/7 and 0/7 needless holds respectively. Each then missed every specific question on its next untouched cohort. In the final cohort we treated “new in 3.9” as an actionable parser diagnosis. Counting the maintainer's request for confirmation as a required question instead changes that row to 0/6 exact questions, 5/6 early advances and 0/6 needless holds. The predicted formatter-edition question still misses the Python grammar distinction. The frozen agent, retrieval and software scores give no evidence of reliable open-ended discovery.

One actual failure was a reported dependency error. The maintainer asked how Black was installed. The reporter identified Pipenv on GitHub Actions. The reader advanced without establishing the install path. Another report looked like Black removed an exception alias. Running the formatter alone preserved it, so the useful next question concerned which hook changed it. The reporter confirmed they had attributed the change to the wrong tool. A diagnostic reader can propose a question. An actual recipient check remains necessary before authorizing a change. [Installer evidence](https://github.com/psf/black/issues/1928#issuecomment-762171106) · [Hook attribution](https://github.com/psf/black/issues/4683#issuecomment-2942202838)

## Two real releases, exact delivery

Black 24.10.0 and 25.1.0 were installed separately. The upstream fixture author chose the actual settings and expected output. The reader got only the original unexecuted text. We withheld the selected settings and golden output, asked whether the default formatter's exact text was safe to deliver, and sealed the question trees on both releases before revealing the receiver's settings.

The first 20 fixtures gave 22/22 useful first questions, 0/18 needless holds and 40/40 correct final decisions, with no changed destinations across releases. We then kept the reader and criteria fixed and ran **all 111 eligible upstream fixtures**. The totals below include the initial 20. The 2025 source supplied the golden output, so only 2025 is graded against that golden for acceptance.

| Black release | Useful first question / required | Needless holds / determinate | Correct final decision / gradable | Unable to format |
| --- | ---: | ---: | ---: | ---: |
| 24.10.0 | 45/45 | 0/65 | 110/110 | 1 |
| 25.1.0 | 45/45 | 0/66 | 111/111 | 0 |

Four real fixture configurations on each release required rejecting the proposed default. The independent receiver CLI matched 111/111 upstream goldens on the matching release. Seven of 110 comparable fixtures delivered different bytes after the upgrade. No final accept/reject Boolean flipped on those 110; the proposed output was recalculated for each release. In `remove_lone_list_item_parens.py` the first release needed the receiver's line-length setting. The second could decide immediately. `remove_with_brackets.py` failed to parse on the old release. On the new release the checker identified the trailing-comma setting as consequential. A separate run through Black's CLI argument parser checked all 1,776 setting combinations, including eight matching parse errors. [All decisions](extended-results.json) · [Sealed prediction digest](extended-predictions.sha256) · [Upstream fixtures](https://github.com/psf/black/tree/8a737e727ac5ab2f1d4cf5876720ed276dc8dc4b/tests/data/cases)

The new library entry checks a trusted repeatable rendering operation, can discover named Boolean reads made along conditional paths, refuses to coerce an untyped unknown to false, and uses the existing Phaseline inquiry planner. Starting from an empty field list produced byte-identical question trees to the sealed experiment. The adapter supplies the candidate operation and Boolean semantics. Without that instrumentation, the natural-language scores above apply. This trial did not measure benefit over a comparably implemented decision tree or independent human adoption.

## Reproduction

Use Node 22 and Python 3.12. Check out the upstream commit linked above at `$work/black`, create virtual environments named `24.10.0` and `25.1.0` under `$work`, and install the matching Black wheel in each environment. Run these commands from this directory with `work` set to an absolute temporary directory. Fixture source is only ever formatted.

```sh
python3 fixtures.py "$work/black" "$work" 10000
for v in 24.10.0 25.1.0; do
  "$work/$v/bin/python" render.py "$work/fixtures.json" "$work/$v.json"
done
node first.mjs "$work/first.json" "$work/24.10.0.json" "$work/25.1.0.json"
python3 grade.py "$work" "$work/first.json" "$work/results.json"
for v in 24.10.0 25.1.0; do
  "$work/$v/bin/python" grid-oracle.py "$work"
done
```

The raw reader is an experimental study adapter. The Git history preserves each frozen edition. For an authenticated read from GitHub, run `collect.py START..END` in an empty directory, give only `positive-inputs.json` to `report_reader.py`, then inspect `positive-private-key.json` after sealing the output. The human grades link both sides of every exchange. No live human participated and archived text may have been in a model's training data.
