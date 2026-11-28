"""After unblinding Rich issue 1019, check which observations distinguish terminal readings."""
import fcntl
from importlib.metadata import version
import itertools
import json
import os
import struct
import subprocess
import sys
import tempfile
import termios
from pathlib import Path

assert version("rich")=="9.11.0"
cli=Path(sys.argv[1]).resolve()
child="""import json,os,shutil
from rich.console import Console
with open(os.environ['OUTPUT'],'w') as f:
 json.dump([Console().size.width,shutil.get_terminal_size().columns],f)
"""
rows=[]
with tempfile.TemporaryDirectory() as temp:
    output=Path(temp)/"widths.json"
    for tty_width, setting, actual_lines in itertools.product([60,100],[60,100],[20,32]):
        master,slave=os.openpty()
        try:
            fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack("HHHH",actual_lines,tty_width,0,0))
            env={**os.environ,"TERM":"xterm","COLUMNS":str(setting),"LINES":str(actual_lines),"OUTPUT":str(output)}
            subprocess.run([sys.executable,"-c",child],stdin=slave,stdout=slave,env=env,check=True)
        finally:
            os.close(master);os.close(slave)
        rich,standard=json.loads(output.read_text())
        rows.append((tty_width,setting,actual_lines,rich,standard))
    assert all(rich==tty and standard==setting for tty,setting,_,rich,standard in rows)
    # Each feature is an observable control. The target is the actual difference at the two readers.
    traces=[{"seen":[f"tty.width={tty}",f"env.COLUMNS={setting}",f"tty.lines={lines}"],"acted":rich==100}
            for tty,setting,lines,rich,standard in rows]
    trace_file=Path(temp)/"traces.json";trace_file.write_text(json.dumps(traces))
    proposal=json.loads(subprocess.check_output([cli,"suggest","prerequisite",trace_file]))
    assert proposal["features"]==["tty.width=100"] and proposal["falsePositive"]==proposal["falseNegative"]==0
    print(json.dumps({"cases":len(rows),"reader_disagreements":sum(r[-1]!=r[-2] for r in rows),
                      "candidate":proposal["features"],"native_version":version("rich")}))
