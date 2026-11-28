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
    if re.search(r"python --version",body,re.I) and len(set(re.findall(r"Python (3\.\d+\.\d+)",body,re.I)))>1 and re.search(r"conda activate|virtualenv|venv",body,re.I):
        return "Does running python -m black inside the activated environment use the same interpreter as the failing black command?", "two interpreter versions"
    if re.search(r"line length",title,re.I) and not code and len(set(re.findall(r"\b(?:[4-9]\d|1\d\d)\b",body)))>=2:
        return "Can you give the smallest source example whose formatting changes between the two line lengths?", "no input for the proposed width comparison"
    if not code or len(code)>5000:
        return None,"triage from supplied report"
    blocks = [v for lang,v in blocks if lang.strip().lower() in {"py","python","python3"} and len(v)<=5000]
    if blocks and re.search(r"^[-+] ",code,re.M):
        code = next((v for v in blocks if not re.search(r"^[-+] ",v,re.M)),code)
    aliases=re.findall(r"except [\w.]+ as (\w+)\s*:",code)
    pipeline=re.search(r"pre-commit run|pre-commit-config",body,re.I)
    width=re.search(r"line length (?:is )?set to [` ]*(\d+)",body,re.I)
    if width and not 1<=int(width[1])<=1000:
        width=None
    discrepancy=re.search(r"internal error|cannot format|can't format|can not format|crash|fmt:\s*skip",text,re.I)
    if aliases and pipeline or width or discrepancy:
        with TemporaryDirectory() as tmp:
            config=Path(tmp)/"empty.toml"
            config.write_text("")
            flags=["--line-length",width[1]] if width else []
            renders=[subprocess.run([exe,"--quiet","--config",str(config),*flags,"-"],input=code,
                     text=True,capture_output=True,cwd=tmp,timeout=10) for exe in binaries]
        if all(r.returncode==0 for r in renders):
            if pipeline and aliases and all(all(re.search(r"except [\w.]+ as "+name+r"\s*:",r.stdout) for name in aliases) for r in renders):
                return "Which hook first removes the exception alias when the hooks run one at a time?", "formatter alone preserves the reported alias"
            if width and all(any(len(line)>int(width[1]) for line in r.stdout.splitlines()) for r in renders):
                return "Is the failure specifically that the formatted result still exceeds the requested line length?", "successful rendering still violates stated width"
            if discrepancy:
                if re.search(r"fmt:\s*skip",text,re.I):
                    return "Which formatter binary and version actually ran on the failing file in that environment?", "reported change versus native output"
                if re.search(r"file name too long|cache dir|different target|target version|not equivalent to the source",text,re.I):
                    return None,"the reported failure depends on storage, syntax target or a cited equivalence check outside this reproduction"
                if re.search(r"long (?:long |string)|default (?:param|value)",text,re.I):
                    return "Can you reproduce the failure with this exact input in an isolated formatter and share the failing reproduction?", "native formatters accepted input"
    return None,"triage from supplied report"

if __name__=="__main__":
    briefs,out,*exes=sys.argv[1:]
    results={k:dict(zip(("question","reason"),decide(r,exes))) for k,r in json.loads(Path(briefs).read_text()).items()}
    Path(out).write_text(json.dumps(results,indent=2,sort_keys=True)+"\n")
