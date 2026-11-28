# Phaseline

Phaseline checks what a product promises as its rules, observers and delivery systems change. Declare the questions, the evidence a person or agent can read, the future actions and who can authorize a change. The CLI can produce a differing case, identify a missing observation or compare signed receiver records to the declared model.

## Install on Node.js 22 or later

Anyone can install Phaseline from the public npm registry and run it locally. For a new application, the Apache-2.0 release with both the CLI and JavaScript library is **0.5.0-rc.54**. Stable 0.4.1 is an earlier CLI package whose npm metadata lists no license. Use a new project directory for either example.

**Stable command line (0.4.1).** Create a case and see which decision can proceed and which still needs evidence.

<!-- public-install: cli -->
```sh
npm init -y
npm install --save-dev --save-exact @verifyrun/phaseline@0.4.1
npx --no-install phaseline init inquiry
npx --no-install phaseline decide inquiry/proposed.phase inquiry/records.json
```

Look for `rely.status` equal to `hold` with `reviewer` named as the owner, and `retain_record.status` equal to `release`. The command completed successfully in both cases. Read the named decision before acting. For a changed rule, `phaseline check inquiry/issued.phase inquiry/proposed.phase` returns exit code 2 and a distinguishing example.

**JavaScript, TypeScript, or a runtime decision gate (public 0.5.0-rc.54 prerelease).** Install this as an application dependency if you call it in production. This is the version for the library, dated approvals and the `--gate` examples below. An unversioned npm install currently selects the 0.4.1 CLI.

<!-- public-install: library -->
```sh
npm init -y
npm install --save-exact @verifyrun/phaseline@0.5.0-rc.54
npx --no-install phaseline init inquiry
node --input-type=module -e "import {gate} from '@verifyrun/phaseline'; import {readFileSync as read} from 'node:fs'; console.log(gate(read('inquiry/proposed.phase','utf8'), JSON.parse(read('inquiry/records.json','utf8')), 'rely'))"
```

The library prints `false` for the missing review. Commit the lockfile and use `npm ci` to reproduce the install. The same case passed to `phaseline decide --gate rely inquiry/proposed.phase inquiry/records.json` exits 2. [Published release and archive](https://github.com/verifyrun/phaseline/releases/tag/v0.5.0-rc.54).

For a worked example in another project's code, [discover a setting the receiver actually reads](examples/configuration/README.md). The example exercises both public versions and checks the effect at the destination.

## A first decision

Save a rule as ship.phase:

    fact approved from hr.approval owner hr missing hold_dependents
    guarantee ship when approved

Save a case as case.json. Times are whole numbers on any clock you choose, such as
seconds since 1970. The case is about subject "alice", an event at 100, reviewed at 200:

    {"subject":"alice","at":100,"asOf":200,"records":[
      {"subject":"alice","at":100,"recorded":150,"source":"hr.approval","by":"hr","value":true}]}

Then run:

    npx --no-install phaseline decide ship.phase case.json

The answer is {"ship":{"status":"release"}}. Remove the record and the answer is a hold
that names the missing fact, its source and who can supply it. Change value to false and
the answer is withhold. Only release means go.

## What compare and decide report

Compare lists changed outcomes and an input that exposes each one.
Decide reports which actions can proceed with the supplied records and who
can supply missing evidence. When eligible records from the declared owner disagree,
the affected action holds. Its need includes reason "conflicting_evidence" and
two dated, contradictory observations. A later timestamp alone does not supersede
an earlier observation. A malformed eligible value yields "invalid_evidence".
An absent record retains the ordinary fact, source and owner request.

Use decide --explain RULES.phase CASE.json to return {actions, undeclaredSourceRecords}.
The count covers records in this subject, event and review window whose source
has no declaration. The checker does not read their values or add a rule for them.
A count of zero cannot establish that every relevant source was supplied.
Decide exits 0 when evaluation succeeds. Automation should read the named action's
status and proceed only on "release".
Add --gate GUARANTEE to make the exit status follow one action: 0 when it is
released and 2 when it is held or withheld. An undeclared name exits 1.

A case names exactly subject, at, asOf and records. Any other field, or a key
that appears twice in one JSON object, is refused with exit 1 so a misspelling
cannot pass as a missing record. Each record names exactly subject, at, recorded,
source, by and value, with whole-number times; a record with another field, a missing
field or a date string is refused the same way, naming the record. In a rule or observer file, a line that starts
with # is a note and changes nothing; a note cannot follow a rule on the same line. Run phaseline --help for the everyday
commands and phaseline --help all for every command.

## Which records count

By default every record from the declared owner for the case's subject and event
must agree, and a disagreement holds. Two optional words at the end of a fact line
change that for one fact:

    fact tests_passed from ci.result owner ci latest within 1440

latest    the most recently written record replaces earlier ones, so a re-run or a
          withdrawn approval settles the fact. Records written at the same time
          that disagree still hold as conflicting_evidence.
within N  only records written in the last N time units before the review count.
          N uses the same unit as at, recorded and asOf in the case. When records
          exist but all are older, the action holds with reason expired_evidence
          and names the owner who must refresh it.

With both, old records are dropped first and the latest of the rest is used.

Use standing for an approval that remains in force across requests for the same subject:

    fact trained from hr.training owner hr standing

The case's at field identifies the request. asOf is the time of the decision or historical read.
For standing facts, at on each source record is its effective time. recorded is when it became
available. Both must be at or before asOf. Use the newest effective period, then the most
recent correction to that period. Conflicting values tied on both dates hold. A scheduled
withdrawal takes effect on its stated date. A late correction to an older period cannot
reinstate an approval. Optional "within N" limits age since recording in the governing period.
Supply original timestamps and the full relevant history. The caller authenticates the source.
Ordinary event facts and "latest" continue to read only records for the request's own event.

Plain standing asks what is in force at the review time. To ask what was in force when the
request happened, write standing at event:

    fact trained from hr.training owner hr standing at event

Only periods that took effect at or before the request's at count, but every record written
by asOf is read, so a withdrawal learned later still applies to the earlier request. Use it
for audits and historical questions. Use plain standing to decide whether to act now.

Adding or removing either word is reported by compare as a changed evidence source.

node scenarios-check.mjs runs ten everyday gates written this way (refunds, deploys,
outbound email, wire release, loan pre-approval, production access, shipping,
publishing, data deletion and model release). Copy one and change the names.

## What a rule cannot say

These need a yes-or-no or a number worked out by the caller before the case is sent:

- A fact compared with another fact (stock >= quantity ordered).
- Text and lists (region is one of EU, UK). Send region_allowed as true or false.
- Dates and durations other than within (the embargo ends on a date).
- Arithmetic (a + b) and !=. Write not (n = 3 items).
- Counting records (two different approvers). Send the count as a number.
- Keep the original effective and recorded times. For an approval that spans requests, the published 0.5 prerelease supports `standing` and `standing at event` as described above. Stable 0.4.1 supports event-specific evidence. Changing timestamps changes which decisions the evidence can justify.

## Use it as a library

    import {decide, gate, compare} from "@verifyrun/phaseline";

    if (gate(rules, subjectCase, "refund")) issueRefund();       // true only on release
    const {refund} = decide(rules, subjectCase);                 // status, and needs when held
    const {status, changes} = compare(oldRules, newRules);       // "preserved" or "review"

rules is the rule file text and subjectCase is the case object. TypeScript types
ship with the package. Each function throws an Error with a plain reason on bad input.

## Check rule edits in CI

Fail a pull request that changes what a rule file promises until someone reviews it:

    git show origin/main:rules.phase > /tmp/old.phase
    npx --no-install phaseline check /tmp/old.phase rules.phase

check exits 0 when every guarantee is preserved, 2 with the changed guarantees and an
example input for each, and 1 on a mistake in either file.

## Use it from another language

    npx --no-install phaseline serve --port 8787

starts a service on this computer only (127.0.0.1). It reads no files and keeps
nothing between requests. Send JSON with content-type application/json:

  POST /decide    {"rules": "<rule file text>", "case": {...}, "explain": false}
  POST /compare   {"old": "<rule file text>", "new": "<rule file text>"}
  GET  /health

A reply with HTTP 200 is the same JSON the command prints. Any other status carries
{"status":"hold","reason":"..."}. From Python, with no extra packages:

    import json, urllib.request, urllib.error

    def phaseline(path, body, url="http://127.0.0.1:8787"):
        request = urllib.request.Request(url + path, json.dumps(body).encode(),
                                         {"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            return json.load(error)

    answer = phaseline("/decide", {"rules": open("rules.phase").read(), "case": case})
    if answer["refund"]["status"] == "release":
        ...  # act; on "hold", answer["refund"]["needs"] names each missing record and its owner

Run node serve-check.mjs to test the service.

## Compare it with your own approach

    node decision-comparison.mjs
    node decision-comparison.mjs --write cases.json
    node decision-comparison.mjs --score answers.json

The first command makes 400 decisions with missing, conflicting and wrongly signed
records, works out the right answer for each by trying every value of the unrecorded
facts, and scores Phaseline, SQLite with NULL for a missing record, SQLite written to
try every value, and the default-false rule. SQLite is run; default false is computed
by its rule, with no policy engine run. --write gives you the cases without answers
so you can encode them in any tool, and --score marks a file of
[{"id": 1, "answer": "release" | "withhold" | "hold"}, ...]. --cases and --seed change the draw.

The browser lessons share the rule engine. The commands read
local files. They do not need a VERIFY account, network access or npm install.
A successful comparison can return "review" or "preserved"; inspect the JSON
status. In CI, use "check" to exit 0 for preservation and 2 for review.
Protect the issued file in your release system. Invalid input produces an error and exits with a nonzero status.

Syntax and supported bounds: https://phaseline.dev/shared
Experiments, source packages and scope: https://phaseline.dev/evidence

Cross-regime handoff, trust inputs and runnable terminal example: https://phaseline.dev/install.html#carry
Run node carry-check.mjs to replay signed and missing evidence, budget and stale-codebook controls.

For larger comparisons, install the Z3 executable on PATH, then run

  node phase.mjs check --solver z3 OLD.phase NEW.phase

This optional backend applies to compare and check. It uses the same Boolean
and bounded-integer meaning as enumeration and returns the same first
witness. Units, bindings and owner changes are still checked by Phaseline.
Each invocation has 15 seconds across all guarantees for the solver work and
a 256 MiB solver memory setting. A missing solver, timeout, invalid response
or failed concrete witness check reports hold and exits 1. Like other SMT
clients this backend trusts Z3 for unsatisfiability. A reported witness is
also checked with the Phaseline evaluator. The default checker runs offline
without Z3.

A signed, bounded quantity can be declared directly.

  fact temp in deg range -40..85 from sensor.temp owner operator
  guarantee alarm when temp < 0 deg

Bounds are inclusive exact integers. A reading outside the declared domain
does not justify an answer. Changing the domain between editions requires a
migration. A fact with no unit is Boolean. An omitted missing-value clause
uses hold_dependents. Legacy USD editions remain readable. Explicitly named
quantities can use their own units and ranges. The CLI reports a spelling
suggestion for a newly introduced undeclared fact close to a known name and
still evaluates the literal program. It never autocorrects the source.
Run node domain-check.mjs to reproduce the boundary checks.

The built-in checker uses exact ordered decision diagrams when enumerating
the input combinations would exceed its budget. No solver installation is
required for this path. compare/check --solver enumerate selects the old
bounded algorithm; --solver diagram selects the diagram from the first
guarantee. All three engines use identical declared domains. Wide conditions
allow 4,096 tokens within the 200,000-character edition limit. An edition
that declares a source and owner for each of 1,000 facts fits. The aggregate
symbolic limits are 100,000 nodes, one million edges and 500,000 composite
calls. Exceeding a bound yields hold. A diagram can be exponential for a poor
variable order. The built-in diagram places inputs in the
order each rule groups them, which keeps paired conditions small; the reported
case is still the first one in alphabetical input order. Debugging counters in an enumerated input space are distinct
from the construction work of a diagram. Neither operation proves that all
relevant real-world states were supplied.

To check what an observer can know as events occur, use the role-aware example.

  node phase.mjs init handoff knowledge
  node phase.mjs knowledge handoff/rules.phase handoff/system.json Guest
  node phase.mjs knowledge handoff/rules.phase handoff/system.json Guest handoff/trace.json
  node phase.mjs knowledge handoff/rules.phase handoff/system.json Guest --plan handoff/demands.json
  node knowledge-check.mjs

The first command after init asks whether the answer is determined along every
possible history. The second reads one supplied record sequence. The last CLI
command prices an adaptive observation policy across all scheduled questions.
The example needs four acquisition units to guarantee all four answers. These
are modeled grants and prices. The CLI role selects an analysis perspective.


Compact regimes specify variables and simultaneous actions. Try a museum archive.

  node phase.mjs init archive archive
  node phase.mjs retain archive/rules.phase archive/model.json
  node phase.mjs encode archive/rules.phase archive/model.json archive/case.json
  node phase.mjs challenge archive/rules.phase archive/model.json archive/trace.json
  node symbolic-retention-check.mjs
  node variable-carry-check.mjs

An unavailable action returns a refusal and keeps the current state unchanged.
An omitted variable assignment keeps its old value. A reachable update outside
the finite domain stops the check. The quotient can be exponential. Computation
limits produce a hold. Compact retention has its own ceiling of two million
diagram nodes, 20 million edges and 20 million composite calls, with at most 2,048
retained classes. Rule comparison keeps its smaller limits so a poor variable
order holds quickly. Encoding reads source-bound observations and charges any
purchases. Signed variable bridges bind the old receipt and both codebooks.


## Test a receiver from observations

    npx --no-install phaseline init shelf receiver
    npx --no-install phaseline challenge shelf/policy.phase shelf/model.json --coverage shelf/terms.json
    npx --no-install phaseline challenge shelf/policy.phase shelf/model.json --coverage shelf/terms.json shelf/observed.json
    npx --no-install phaseline challenge shelf/policy.phase shelf/model.json --coverage shelf/terms.json shelf/misrouted.json

The first test command generates operations. The next two verify signed records from a disposable database read through two separate SQLite connections. The ordinary receiver conforms under its declared six-state bound. A receiver which commits when asked to roll back leaves the flag set after begin, mark, undo. The last command exits 2. The example key authenticates these fixture records. A real receiver needs its own previously trusted key, grounded state bound, origin, permission and tariff.

A complete finite test relies on a fixed deterministic receiver, the stated origin, exhaustive input alphabet and justified upper bound. A false state bound can hide a longer distinguishing sequence. Without an attested bound this command can still report an observed disagreement. It cannot certify general agreement or supply an absent grant.

Use phaseline compare --machines issued.json proposed.json to compare deterministic transition editions with their own origins, input alphabets and typed replies. A changed result includes a shortest sequence with the two observed outputs. An unobserved reachable edge or exhausted work budget yields a hold. The check form exits 2 for a difference.

## Replace a reviewer and verify its first delivery

    npx --no-install phaseline handoff open account.sqlite root.json enrollment.json
    npx --no-install phaseline handoff step account.sqlite request.json
    node node_modules/@verifyrun/phaseline/funded-review-check.mjs

Use Node 22.13 or newer for the SQLite handoff. The runnable check creates its own temporary keys and private receiver. An enrollment fixes the incumbent source, predecessor, operators, receiver, input domain and one account. The operator pays to ask and retain the original verdict and its work for each input, constructs an executable .phase policy, then offers its exact bytes. The predecessor checks those bytes and can authorize first use. The receiver runs the installed program after restart. A funded read checks the actual delivered content. Repeating a read inspects current bytes and evidence again. Spent operations survive process loss when the same authoritative account file survives.

The supported reviewer accepts a position and a Boolean claim. It returns allow, refuse or hold with one of four work charges. Its declared source must be truthful and stable. The tariff measures declared work units. An installation supplies the trusted runtime, protected database and source of observations.

## Compare the work a caller can afford after a revision

    npx --no-install phaseline compare --machines old.json new.json --wallet any
    npx --no-install phaseline check --machines old.json new.json --wallet 65

Use phaseline.priced-transducer/1 with the normal inputs, initial state, missing-edge treatment and states. Each available edge has input, to, output and a positive exact integer work charge. Set onExhaustion to keep or consume. An unfunded operation emits exhausted and preserves the service state. The setting controls whether the remaining balance survives. Unavailable, exhausted and completed are distinct public replies. The caller sees the value on completion. The diagnostic also reports remaining funds. Starting balances are exact decimal integers.

The first command returns the least opening balance and a replayable sequence exposing a public difference, or equivalence for every opening balance. The second checks that exact balance. A difference at one balance can disappear when the caller has one more credit. Undeclared or unobserved behavior and limits on search work can leave a conclusion on hold.


Finding a safe way to finish a job
---------------------------------
phaseline knowledge RULES.phase SYSTEM.json ROLE --achieve TASK.json

Use the same finite regime, roles, observations and grants as the knowledge command.
A task names a goal, optional safety question, optional terminal questions to settle,
and commands with a positive cost and possible effects. A command is usable only
when authorized and enabled in every remaining history. The receiver chooses any
enabled effect. The result is the minimum worst-case execution cost, a policy for
the declared role, a losing obstruction, or a hold if search stops early.

An opening handoff grant can separately enroll a receiverContract with store,
history (complete_job_log or current_content_only) and repeat (stable_job or
may_repeat). The job pins its external base and grant epoch. Signed plan, dispatch,
inspect and record operations use the same original account. Plan prepays model
intake and a bounded search allowance and pays for issuing its result. A retained
observation identifies its snapshot. A current content match alone can leave the
original delivery unknown. The standalone distribution interprets the protocol.
An actual destination needs an adapter and an authorized evidence source.

Use challenge --inputs CONTRACT.json to page through original input values before
normalization. Pass a signed receiver report to audit the proposed projection.
A counterexample gives two raw inputs with the same retained record. Where a read
is missing, the checker can exhibit two possible sources that match every reading.
A positive result covers the declared fixed finite port and demand.

Private candidate. A record lookup with time "at_use" asks for a current decision
at the destination's first visible use. The record owner enrolls a live source
and a price. The source signs a reservation for the exact ticket. Its writers must
preserve the approved version, field, audience and unique title until a signed
receiving outcome arrives. An unresponsive receiver can delay a withdrawal.
Reserve this contract for sources whose owners accept that tradeoff.

In an embedding application, use reserveCurrentSource(), activateCheckedRelease()
and settleCurrentSource() for the same issued ticket. If the original return and
its prepaid replay were both lost, the receiver can issue recover_terminal through
handoff step and pass the funded ticket to readTerminalReceipt(). Each new read
uses the same project account and returns only an existing signed outcome.
Run node current-source-check.mjs from the installed package for a local example.

A source administrator can submit a withdrawal or version change with requestSourceEdit()
using the basis from sourceEditBasis(). Read edit_pending as a requested change.
edit_applied confirms that the edit committed at the source. An older display may
still contain an earlier release. Once the owner uses this interface, every source
writer must run the current code. Existing source databases migrate on first use.
Unrelated first uses can still proceed. Existing conflicting uses must settle.

With a source-approved editPrice, the project receiver can pay for coordinate_source_edit,
sign its issued query with signEditQuery(), and send it to answerEditQuery(). A signed
answer can close that attempt through honorSourceFence(). Send its actual first-use
receipt back to settleCurrentSource(). The first visible use can win the race before
the edit commits. A disconnected destination may leave the owner waiting. Run
node source-edit-check.mjs to exercise the source controls on a disposable database.

Choosing a current source record
--------------------------------
For a ranked search or a named catalog lookup, time "at_use" with keep "chosen_record"
asks whether the specific edition chosen by the owner can still supply the same
field to this audience at first use. Present the original candidates, obtain
the field and sign the choice of its ID, edition and catalog digest. Even a
single result requires a choice. The owner can decline every suggestion.
A different preferred search result does not change this selection. A changed
chosen edition or withdrawn audience withholds it. The named unique-title check
remains available when uniqueness itself matters.

Use chosenRecords: true in both the project's live terms and the authoritative
source subscription. For an existing source, its local administrator can call
enableChosenRecordUse(path, expectedBinding) with the enrolled project binding.
This durably requires compatible writers; upgrade writers before enabling it.
The old project's signed enrollment retains its original permissions. A
guarded receiving destination must participate through its terminal receipt.
Run node chosen-record-check.mjs for a disposable test, optionally passing the
previous installed package directory to check a real source upgrade.

Large source catalogs
---------------------
The default authoritative source accepts 4,096 records. Its local administrator
can raise storage capacity with raiseSourceCapacity(path, expectedBinding, n).
This does not grant anyone additional disclosure. seedCurrentRecords imports up
to 512 source-controlled initial editions per atomic batch. Retrying identical
data is safe. If a source promise or edit is pending, use the ordinary writer.
eligibleRankedRecords checks up to 100 candidate identities inside the source
against current sharing and returns at most three eligible entries. Omitted
items remain unknown. Keep the same lookup and first-use pricing/approval rules.
Run node source-population-check.mjs to reproduce capacity and audience cases.

Concurrent source readers
-------------------------
Catalog reads, ranked suggestions, source-field observations and source-state
inspection use a read-only transaction over one committed snapshot. Source
edits and first-use reservations still acquire a write transaction. A pending
write can therefore leave the old committed edition readable before commit;
withdrawal is visible to a new read after commit. Initial observations alone
never establish eligibility at first use. Run node concurrent-source-read-check.mjs
to compare two journal modes with native SQLite during rollback and commit.

## License and security

Apache License 2.0; see LICENSE and NOTICE. Report vulnerabilities privately as
described in SECURITY.md. Changes are listed in CHANGELOG.md.

### Checking a proposed text output in a consuming application

The review branch adds `inquireOutput` to the JavaScript entry point. A trusted, isolated operation can read Boolean settings by name. The checker tries both values locally, follows conditional reads, and returns the first permitted receiver question that can settle whether the proposed text is correct within the remaining budget. For example, a formatter can ask whether to retain the original quotes only on files where that choice changes the delivered text.

```js
import {inquireOutput} from "@verifyrun/phaseline";

const render = (_, readBoolean) => readBoolean("retainQuotes") ? "'hello'" : '"hello"';
const access = {known: {}, readable: ["retainQuotes"], budget: 1};
const first = inquireOutput([], render, '"hello"', access);
// first.status === "ask"; first.setting === "retainQuotes"
```

Pass the observation back through `known` and debit the question from the budget. A new edition must run its own operation. A question costs one receiver read. The fixture may be evaluated repeatedly across at most seven Boolean dimensions. Keep it deterministic, isolated from external effects, and put every material setting through the supplied reader. An untyped read of an undeclared property holds. An unsupported dimension count holds. External state that bypasses the reader lies outside the result. An ordinary bug report can still omit an unidentified fact. [Independent trials and limits](studies/formatter-discovery/README.md)
