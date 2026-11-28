from pathlib import Path
from io import StringIO
from importlib.metadata import version
import json
import sys
from rich.console import Console
from rich.markdown import Markdown
from commonmark import commonmark

source = Path(sys.argv[1]).read_text()
seen = {}
for separation in (0, 1, 2):
    lines = source.splitlines()
    indented = next(i for i,line in enumerate(lines) if line.startswith("       "))
    lines[indented:indented] = [""] * separation
    source_variant = "\n".join(lines)
    f = StringIO()
    console = Console(file=f,force_terminal=False,color_system=None,width=72)
    console.print(Markdown(source_variant))
    for renderer, rendered in [('parser_html',commonmark(source_variant)),('consumer_terminal',f.getvalue())]:
        # Preserve the promise in the original report: these two visible fragments retain document order.
        fragments = ['first item','code block']
        assert all(rendered.count(x)==1 for x in fragments)
        first,block=[rendered.index(x) for x in fragments]
        seen[f'{separation}:{renderer}'] = first<block
print(json.dumps({'rich':version('rich'),'parser':version('commonmark'),'outcomes':seen}))
