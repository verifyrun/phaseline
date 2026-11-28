"""Decide the next triage step for a formatting report; this never authorizes a release."""
import json
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory

def decide(report,binaries):
    title=report["title"]
    body=re.sub(r"<!--.*?-->", "", report["body"],flags=re.S)
    text=title+"\n"+body
    if re.search(r"symbolic link|symlink",title,re.I) and not re.search(r"<junction>|\s->\s|ln -s|mklink",body,re.I):
        return "Which exact path is the link, and where does it point?", "missing path mapping"
    if re.search(r"line (?:length|width)|short width|character width",text,re.I) and re.search(r"khmer|wide characters|display width|unicode|visual width|east asian",text,re.I):
        return "Which downstream tool or display rejects the resulting line, and how does it measure its width?", "receiver width convention"
    blocks=re.findall(r"```([^\n`]*?)\r?\n([\s\S]*?)```",body)
    code=next((v for lang,v in blocks if lang.strip().lower() in {"py","python","python3"}),None)
    if code is None:
        code=next((v for lang,v in blocks if not lang.strip() and re.search(r"^(?:def |class |from |import |\w+\s*=)",v,re.M)),None)
    if not code or len(code)>5000:
        return None,"triage from supplied report"
    if re.search(r"internal error|cannot format|can't format|can not format|crash|fmt:\s*skip",text,re.I):
        # Inputs are only presented to a formatter on stdin. Never execute report commands or imports.
        with TemporaryDirectory() as tmp:
            config=Path(tmp)/"empty.toml"
            config.write_text("")
            renders=[subprocess.run([exe,"--quiet","--config",str(config),"-"],input=code,
                     text=True,capture_output=True,cwd=tmp,timeout=10) for exe in binaries]
        if all(r.returncode==0 for r in renders):
            if re.search(r"fmt:\s*skip",text,re.I):
                return "Which formatter binary and version actually ran on the failing file in that environment?", "reported change versus native output"
            return "Can you reproduce the failure with this exact input in an isolated formatter and share the failing reproduction?", "native formatters accepted input"
    return None,"triage from supplied report"

if __name__=="__main__":
    briefs,out,*exes=sys.argv[1:]
    results={k:dict(zip(("question","reason"),decide(r,exes))) for k,r in json.loads(Path(briefs).read_text()).items()}
    Path(out).write_text(json.dumps(results,indent=2,sort_keys=True)+"\n")
