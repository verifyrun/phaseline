# Did Phaseline ask before acting?

The public standalone checker was installed in a clean Node 22 application. Two outside projects supplied the answers: Google’s archived Schema-Guided Dialogue services and the maintainers of the Rich Python library. The hotel records come from simulated transactions with crowd-written utterances. The Rich issues are actual public reports. No person was recruited for this run and no external booking or issue action was performed.

## A consequential fact outside the parameter list

The hotel API lists the required reservation parameters. Having all of them still leaves a decision: has the customer approved these particular terms? Our RC55 consumer advanced on all 191 validation turns where the next recorded step was confirmation. RC55 already knew how to enforce a declared consent rule. It had no trace-based suggestion command, and this consumer had never declared consent.

The new command compared every observed single feature and pair against actions and waits in 3,917 earlier examples from 15 **non-hotel** services. It proposed the customer’s affirmative response. That feature appeared before all 1,825 calls and also before 23 waits. An independent Python enumeration found the same feature and errors. The command proposed an association. We supplied the additional receiving rule: count a reply only following a confirmation for the same service, and hold an edit or negative reply. That extra qualification was written by the experimenter. The bundled consent example shows how an application can bind actual evidence to a recipient and offer version.

| Held-out hotel confirmation test | Correct first consent question / 191 | Advanced prematurely | Asked something else | Unnecessary holds / 169 call turns |
|---|---:|---:|---:|---:|
| RC55 with the published required parameters | 0 | 191 | 0 | 0 |
| New proposal, applied literally to structured dialogue events | 183 | 8 | 0 | 0 |
| Receiver rule, same structured events | 191 | 0 | 0 | 0 |
| Receiver rule with a text-only statistical reader | 183 | 6 | 2 | 27 |
| Hold everything | 0 | 0 | 0 (191 generic holds) | 169 |

After those 191 questions the authors’ next turns contained 169 affirmations and 22 refusals. At dialogue 18_00069, user turn 8, the reader had the reservation inputs and asked for approval. The next reply corrected the booking to two rooms and seven days. No later utterance entered the prediction. An ordinary Python rule given the same structured events matched the Phaseline receiver on all 695 eligible prefixes. [Original dialogue shard](https://github.com/google-research-datasets/dstc8-schema-guided-dialogue/blob/e852981ae34990f4358979625854259302feaa78/test/dialogues_018.json)

The original field-question score remains separate. With the supplied user state, both the RC55 consumer and the new receiver asked the author’s first requested field on **126/149**, included an author-requested field among their needs on **149/149**, advanced early on zero and held zero of 169 call controls. Of those 149 questions, the next user reply supplied a requested value 143 times. Removing the last published required field from the local rule produced the same score, so that omission did not distinguish the systems here. The original text-only nearest-neighbour reader got the first field right 69/149 and advanced on 54 question turns. The revised raw receiver got 36/149, advanced on zero field-question turns, and held 27 call controls. **We would not adopt it as a general field reader.** These are input-readiness scores. Neither text reader produced verified payloads. The original exact-string comparison of all required values matched zero calls; the annotations contain surface dates and names while the call logs use canonical forms.

On a second service, house rentals, the structured receiver asked for approval on **148/148** and held **0/117** call controls; 31 people in the recorded scenario declined. A stricter wording check in the raw consumer reduced premature approvals from **4 to 0**, but raised needless holds from **18 to 52**. It still advanced on one of 130 ordinary field-question turns. The simpler Python receiving rule matched all 487 structured prefixes. The wording guard is experimental and unsuitable as release authority. [Hotel results](hotel-results.json) · [House results](house-results.json)

## Original issues answered by real maintainers

On eight closed Rich issues the template-based reader asked the same first question on **1/3** information requests. It advanced on none of those three, but requested the wrong evidence twice. It held **4/5** cases where a maintainer could start from the opening report. Two information requests included a tentative diagnosis; one of the five advances was provisional. None of the three original reporters subsequently supplied the requested artifact in those threads. The human asking for the affected terminal on #2827 and for generated HTML on #2831 shows why a uniform request for a runnable example fails. [Terminal request](https://github.com/Textualize/rich/issues/2827#issuecomment-1445201865) · [HTML request](https://github.com/Textualize/rich/issues/2831#issuecomment-1445200161)

We fixed that consumer to distinguish the output being diagnosed and recognize alternative evidence. It recovered the three questions and all five advance cases on replay. On **20 different reports**, 11 first substantive maintainer replies could be scored. The repair reduced unnecessary holds from **3/11 to 1/11**. Eight reports lacked a qualifying maintainer reply and one was closed for conduct. All 11 scored replies offered a technical answer or change; the transfer cohort supplied **no positive cases** for independently confirming the improved question accuracy. The ascertainment was fixed before opening comments. Issue text and code snippets are evidence for human triage. Neither reader diagnoses the bug. [Per-issue predictions and scores](rich-results.json) · [First reply grades](rich-gold.json) · [Transfer grades](rich-transfer-gold.json)

### Did the repaired reader find a real reporter’s hidden fact?

A third, separately sealed cohort held back both the maintainer’s first reply and the original reporter’s later response. Sixteen other Rich threads were selected. Four first replies asked for a specific fact and twelve could proceed with a diagnosis or suggestion. On this fresh positive test the original reader asked **0/4** exact questions, advanced early once, and held **11/12** actionable cases. The revised reader also got **0/4**. It advanced early on **all four** and held **7/12** actionable cases. The revised triage heuristic remains an experiment. We reject it as an automatic decision to proceed. One information request combined a tentative conclusion with a consequential follow-up; omitting that case leaves zero exact matches on three. [Frozen predictions](positive-predictions.sha256) · [Independent grades and reporter replies](positive-gold.json) · [All 16 scores](positive-results.json)

In #1036 a runnable Markdown example was already present. The maintainer asked the reporter to insert a blank line after the list and rerun it. The error persisted, and the maintainer later supplied a fix. In #1019 the maintainer asked about a resize and actual terminal dimensions. The reporter compared terminal emulators with a real TTY. A question about which terminal they generally used would miss the diagnostic experiment. [Markdown exchange](https://github.com/Textualize/rich/issues/1036#issuecomment-782858939) · [Terminal exchange](https://github.com/Textualize/rich/issues/1019#issuecomment-780432055)

After opening the answers, we installed the reporter's Rich **9.11.0** and varied actual TTY width, COLUMNS and line count independently in eight local runs. Rich followed the TTY width. Python’s standard reader followed COLUMNS. Their observed widths differed in four runs; the generic proposal chose the actual TTY width for the measured Rich output. This shows a path from possible explanations to a specific source measurement. We chose the experimental controls after reading the exchange. It earns **no blind credit** and does not establish the cause on the reporter's machine. Replay with a separate Python environment containing rich==9.11.0: `python native_width.py /path/to/installed/node_modules/.bin/phaseline`.

## Reproduce

Use a checkout of this review branch with its history, Node 22, npm, Python 3 and curl. The script fetches the 34 upstream shards and never passes future turns to the predictors. The external readers and recorder are study code; only the generic proposal function, CLI and example rule ship in the package.

```sh
work=$(mktemp -d)
git worktree add --detach "$work/rc55" f3654d03089b713916d1472db625ee9c5c73c5f3
(cd "$work/rc55" && npm pack --pack-destination "$work")
npm pack --pack-destination "$work"
python3 studies/standalone-discovery/replay.py "$work/trial" \
  "$work/verifyrun-phaseline-0.5.0-rc.55.tgz" "$work/verifyrun-phaseline-0.5.0-rc.56.tgz"
```

For Rich, run the two collect scripts in an empty directory with the GitHub CLI authenticated. Copy the two Rich readers beside a clean candidate project's node_modules, run each with the inputs JSON and an output filename, and compare to the committed grades by sealed issue ID. The scripts in this folder retain the original source criteria, predictions' hashes and separate transfer grades. Public issues can be edited after this run. [Original protocol](protocol.md) · [Consent protocol](supplement.md) · [Sealed predictions](predictions.sha256.json) · [Rich transfer protocol](rich-transfer.md) · [Source dataset and license](https://github.com/google-research-datasets/dstc8-schema-guided-dialogue)
