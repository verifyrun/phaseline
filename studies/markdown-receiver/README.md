# Replay a missed question on a real renderer

In [Rich issue 1036](https://github.com/Textualize/rich/issues/1036) the reporter supplied a Markdown document whose code block appeared before its list items on the terminal. Our prior text reader considered the report sufficient and did not investigate. The maintainer asked the reporter to insert a blank line. It made no difference. The reporter later confirmed the fix in Rich 9.12.0.

This retrospective replay executes the original fenced Markdown as inert data. Save its first fenced Markdown block as `report.md`. In two separate Python environments install `rich==9.11.0` and `rich==9.12.0` respectively, both using `commonmark==0.9.2`. Run `python render.py report.md > old.json` and `python render.py report.md > new.json` in their respective environments. With either public Phaseline package installed, run:

```sh
node check.mjs node_modules/@verifyrun/phaseline/phase.mjs old.json new.json
```

We crossed two Rich versions, the parser’s HTML versus Rich’s terminal renderer, and zero, one or two additional blank lines. The parser preserved the order in all six runs. The older terminal renderer reversed it in all three runs. The newer terminal renderer preserved it in all three runs. With the terminal surface known and the edition withheld, Phaseline selects the edition as the observation to obtain. With the old edition known and surface withheld, it selects the surface. Additional blank lines do not resolve either distinction. For the parser alone or the new edition it answers directly.

The reporter's own retest supplies independent confirmation on their machine. An investigator chose the operation, candidate causes and ordering check after reading the exchange. This repair to the diagnostic workflow earns no new blind question-discovery credit. The original 0/4 result stays on issue 3.
