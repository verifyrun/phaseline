# Which tool actually changed this file?

The package exports `traceProducer` through its JavaScript API. Give it one receiving run, a specific artifact, a symptom predicate, and the ordered stages that could have changed that artifact. It asks for the first missing observation needed to trace the symptom back to the last stage that introduced it. The caller collects the evidence. A version number, a configured default and two tools producing identical bytes cannot identify which installation ran.

## What reached the file

We ran the ordinary Format Document command in VS Code 1.138.0, saved the JavaScript file and read it back from disk. In v1 we used the Prettier extension 10.4.0. A fresh editor process ran extension 11.0.0 on v2, after verifying the 12 files still contained their actual v1 results and making a second edit. The routes were the bundled formatter, a separately installed copy at the same version, a newer workspace formatter, and the editor's built-in TypeScript provider. Eleven of twelve assignments changed. The team running this study controlled the fixture. The historical report authors and maintainers were independent. There was no live human examiner.

| First action | v1 (development) | v2 (sealed before opening the route key) |
| --- | ---: | ---: |
| Correct tool and installed copy on changed files with full receiver evidence | 8/8 | 8/8 |
| Right question when current evidence was withheld | 16/16 | 16/16 |
| Advanced before obtaining that evidence | 0/16 | 0/16 |
| Asked or held when evidence already settled the case | 0/20 | 0/20 |
| Matched the independent editor replay, including unchanged files | 12/12 | 12/12 |

Each edition had twelve files. Eight changed. Hiding the installation or all current evidence gave two required questions for each of those eight. The twenty actionable views were the eight complete records plus the four unchanged files shown three ways. Those are repeated views. Each real save had one observed formatting operation. Multi-stage introduction, removal and reintroduction are separate package regression tests.

A further clean setup exposed a startup failure. Two format commands left the file unchanged and had no matching provider log. The replay harness now waits for a separate probe file in the same workspace folder to format successfully and binds measured logs to the exact target file. Two subsequent clean setups reproduced every sealed response on both releases.

For a causal cross-check we reopened each **identical v2 input** and switched only its formatter selection between Prettier and the built-in provider. Both providers logged their respective operations on all twelve files. The saved bytes differed on all eight changed cases and agreed on the other four. On `part-02`, v1 used the workspace copy of Prettier 2.8.8. The v2 TypeScript server handled the file. Reusing v1's record gave a question, never credit for attribution. This comparison establishes a difference between those two providers on those inputs. A trusted run log was still required to identify a particular installation.

[Protocol](protocol.md) · [Sealed v2 answers](first-v2.json) · [Independent replays and byte hashes](receiver-results.json) · [Provider-switch results](intervention-results.json)

## Can an unaided report reader find that question?

The deterministic Python reader is a study adapter. It reads the original public issue opening and can retrieve dated project manifests. The installed package test above starts with actual observations. An unstructured report can leave open which operation occurred, which system to inspect, and whether anybody needs to ask a question at all.

| Test | Right question / needed | Early advance / needed | Needless hold / actionable |
| --- | ---: | ---: | ---: |
| Original unseen Black cohort, before this work | 0/5 | 5/5 | 1/7 |
| Same Black cases, repaired adapter, answers already known | 5/5 | 0/5 | 0/7 |
| First sealed editor cohort, 13 reports | 1/6 | 0/6 | 6/7 |
| Revised reader, next 24 unseen editor reports | 1/9 | 0/9 | 11/11 |

On the last cohort the reader asked on every report. Eight of nine required questions targeted the wrong evidence. Four more cases had disputed diagnoses or disputed need for information. All four received questions and all four are shown in the [per-report grades](final-grades.json). Counting them as actionable instead would yield 15/15 needless holds. In the first cohort, treating #323 as immediately actionable would give 0/5 right questions and 7/8 needless holds. These small, selected historical cohorts and human judgments are evidence about this reader, not population estimates.

What worked: on [#65](https://github.com/prettier/prettier-vscode/issues/65), the reader asked which installation the editor loaded compared with the CLI. The reporter identified a project-local Prettier 0.0.5. What failed: on [#537](https://github.com/prettier/prettier-vscode/issues/537), the reader requested a formatter log. The maintainer asked whether the dependencies had ever been installed. Running the install fixed it. On [#512](https://github.com/prettier/prettier-vscode/issues/512), the maintainer could point directly to the save timeout.

The initial 16-report archive block lost its blind status when a syntax error prevented recording its answers before the comments were read. It is included as [replay only](replay-grades.json). A replacement cohort was [sealed](https://github.com/verifyrun/phaseline/commit/7c8f6ec) before grading. We then revised the adapter and [sealed the final 24](https://github.com/verifyrun/phaseline/commit/cdceb14) before opening either answer key. The original 0/5 remains on record. Original opening snapshots matter: the specific revision in Black #1935 was added later. The historical grader is an interpretation of actual maintainer/reporter exchanges; mixed cases can be inspected individually.

## Reproduce

With Node 22, Python 3, npm and VS Code, run `bash studies/producer-trace/run-editor.sh` twice from a clean checkout. The script checks both official VSIX digests and uses disposable profiles, extension folders and workspaces. Set `VSCODE_EXECUTABLE` to select the editor binary. Each run prints its capture directory. With the pinned editor build, run `python3 studies/producer-trace/score-receiver.py FIRST_CAPTURE SECOND_CAPTURE` to compare both sets of bytes to the sealed decisions. To replay the intervention, copy the captured v2 workspace into a fresh capture directory, use its own extension/profile paths, run `intervene.py` to restore the original input bytes and switch providers, and repeat the same Format Document drive. Native TypeScript versions can vary with editor builds.

For another prose test, predeclare the project and window, run `collect.py` into separate study directories, then `seal.py ROOT ANSWERS.json DIR...` and commit the complete first responses before reading the sealed comment files. The grader publishes its evidence links and a disposition for every row. Run `python3 studies/producer-trace/check.py` to check the saved first-action coverage and reader regressions. Raw local logs and user profiles are unnecessary for the shared scorecard.

The remaining discovery problem is choosing a discriminating observation (or proceeding directly) before the host has supplied a useful trace. The next experiment should let the consumer consult the affected project's actual command registration, effective configuration, installation or invocation, record what it reads, and compare it with a maintainer's first actionable step on new reports. A blanket hold fails the actionable controls.
