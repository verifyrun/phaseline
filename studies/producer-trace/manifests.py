"""Read only historical public reproduction metadata. A manifest shows intent, never the running installation."""
import base64
from datetime import datetime
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlencode
from collect import gh

def retrieve(report,opened):
    files={}
    refs=re.findall(r'https://github\.com/([\w.-]+/[\w.-]+)',report["body"])
    for repo in list(dict.fromkeys(refs))[:3]:
        repo=repo.rstrip(".,)")
        if repo.lower().startswith(("prettier/","microsoft/","facebook/","eslint/")):continue
        try:
            if gh("repos/"+repo).get("visibility") != "public": continue
            commits=gh("repos/"+repo+"/commits?"+urlencode({"until":opened,"per_page":1}))
            if not commits:continue
            sha=commits[0]["sha"]
        except (subprocess.CalledProcessError,KeyError):continue
        for path in ("package.json",".vscode/settings.json"):
            try:
                obj=gh("repos/"+repo+"/contents/"+path+"?ref="+sha)
                data=json.loads(base64.b64decode(obj["content"]))
                if not isinstance(data,dict):continue
                keys=("prettier","eslint","@biomejs/biome","prettier-vscode") 
                if path=="package.json":
                    facts={k:v for sec in ("devDependencies","dependencies") for k,v in data.get(sec,{}).items() if k in keys}
                else:
                    facts={k:v for k,v in data.items() if k in ("editor.defaultFormatter","editor.formatOnSave","prettier.requireConfig")}
                files["https://github.com/"+repo+"/blob/"+sha+"/"+path]=facts
            except (subprocess.CalledProcessError,ValueError,KeyError):continue
    return files

if __name__=="__main__":
    root=Path(sys.argv[1]); merged={}
    for directory in (root,root/"second",root/"third"):
        # Examiner hands off opening timestamps only, omitting all later text.
        dates={k:v["opening_at"] for k,v in json.loads((directory/"sealed-human.json").read_text()).items()}
        for k,brief in json.loads((directory/"openings.json").read_text()).items():
            assert k not in merged
            merged[k]={**brief,"projectFiles":retrieve(brief,dates[k])}
    (root/"reader-input.json").write_text(json.dumps(merged,sort_keys=True))
