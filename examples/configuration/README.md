# Find a setting before relying on a software change

A Python application loads a label from configuration. Its owner wants to know whether the label at the destination will be “coffee.” The operation runs in an isolated test fixture. The source probe collects which configuration names the operation actually reads, varies their values, and records the label the recipient ends up with. A field discovered only after an earlier switch is enabled gets probed too. Phaseline then determines which allowed observation, if any, could change the answer.

The adapter supplies a question, a small set of possible values and the permission to read a test setting. It supplies neither the hidden setting's name nor a model of the library's behavior. Look at `dotenv_demo.py` for the integration and `probe.py` for the reusable portion. Only the separately run grading fixture names the expected setting.

## Reproduce

[Download the example with all three Python files](https://github.com/verifyrun/phaseline/releases/download/v0.5.0-rc.54/phaseline-configuration-example.zip). Extract it, open the extracted directory, and use Node 22+ with an active Python 3.10+ virtual environment. Install the public CLI in that directory.

```sh
npm install --save-dev --save-exact @verifyrun/phaseline@0.4.1
python -m pip install python-dotenv==1.1.1
python check.py node node_modules/@verifyrun/phaseline/phase.mjs
python -m pip install python-dotenv==1.2.0
python check.py node node_modules/@verifyrun/phaseline/phase.mjs
```

Run `python dotenv_demo.py node node_modules/@verifyrun/phaseline/phase.mjs` to see the discovered names, actual probe count, and the recommended question in plain JSON. The same example works with the public CLI in 0.5.0-rc.54.

Version 1.1.1 always produced the target. Version 1.2.0 read an additional switch. If the label was absent or initially “tea,” Phaseline asked for that switch before predicting the outcome. If it was already “coffee,” it answered immediately. When authority to read a consequential switch was removed, it reported the unresolved distinction. Across both versions the six starting cases yielded two necessary questions, zero missed questions and zero unnecessary questions. Each of the 18 final predictions was checked against an independently rerun local recipient.

The sample covers this operation with the setting absent, “0” or “1”. It cannot infer every possible input or every dependency of an arbitrary program. An untested configuration requires another observation. Each fixture runs twice. Changes in the reads or destination on identical inputs, enumeration of an unknown key space, or exhausting the run limit raise `Unmeasured`. Permission to vary synthetic fixtures never grants permission to read a production environment. The example uses the public checker; ordinary Python supplies the observations and executes the destination. A direct comparison of the same outcomes also identifies the distinction.

[Upstream releases and changes](https://github.com/theskumar/python-dotenv/compare/v1.1.1...v1.2.0).
