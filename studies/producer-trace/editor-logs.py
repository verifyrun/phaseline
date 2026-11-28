"""Read completed provider events; the examiner's assignment and folder settings are never read."""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse, unquote

def records(root, version):
    host=root/("host-"+version)
    files=json.loads((host/"observations.json").read_text())
    logs=host/"profile/logs"
    observations={}
    def observe(name,tool,install):
        if name not in files: return
        view=observations.setdefault(name,set())
        view.add((tool,install))

    for p in logs.rglob("*Prettier.log"):
        text=p.read_text()
        if "Extension Version: "+version+"." not in text:continue
        for segment in re.split(r'^\["INFO"[^\n]*?\] Formatting (?=file:)',text,flags=re.M)[1:]:
            if "Formatting completed in " not in segment:continue
            name=Path(unquote(urlparse(segment.splitlines()[0]).path)).parent.name
            match=re.search(r'PrettierInstance:\s*(\{)',segment)
            if not match:continue
            obj=json.JSONDecoder().raw_decode(segment[match.start(1):])[0]
            if "modulePath" in obj:
                package=Path(obj["modulePath"])
                while not (package/"package.json").is_file() and package!=package.parent:package=package.parent
                manifest=json.loads((package/"package.json").read_text())
                assert manifest["name"]=="prettier" and manifest["version"]==obj["version"]
                ident=package.relative_to(root).as_posix()+"@"+obj["version"]
            else:
                # Both pinned extension releases log the bundled module itself and wrap external modules with modulePath.
                if "format" in obj or "version" not in obj or "__internal" not in obj:continue
                ident="esbenp.prettier-vscode@"+version+"/bundled-prettier@"+obj["version"]
            observe(name,"esbenp.prettier-vscode",ident)

    for p in logs.rglob("tsserver.log"):
        content=p.read_text()
        managed=re.search(r'Arguments: .*?(/[^\n]*?/extensions/node_modules/typescript/lib/tsserver\.js) ',content)
        build=re.search(r'Version: ([^\s]+)',content)
        if not managed or not build:continue
        requests={};done=set()
        for m in re.finditer(r'^\s*(\{)',content,re.M):
            try:obj=json.JSONDecoder().raw_decode(content,m.start(1))[0]
            except ValueError:continue
            if not isinstance(obj,dict) or obj.get("command")!="format":continue
            if obj.get("type")=="request":requests[obj["seq"]]=Path(obj["arguments"]["file"]).parent.name
            if obj.get("type")=="response" and obj.get("success"):done.add(obj["request_seq"])
        for seq in done & requests.keys():
            observe(requests[seq],"vscode.typescript-language-features","vscode/bundled-tsserver@"+build[1])
    result={}
    for name,v in files.items():
        assert v["release"]==version
        binding={"run":version+"-"+name,"release":version,"subject":name+"/sample.js"}
        event={**binding,"steps":1,"before":v["before"],"after":v["after"]}
        result[name]={"event":event,"receipts":[{**binding,"step":1,"tool":t,"installation":i}
                  for t,i in sorted(observations.get(name,set()))]}
    return result

if __name__=="__main__":
    root=Path(sys.argv[1]);version=sys.argv[2]
    Path(sys.argv[3]).write_text(json.dumps(records(root,version),sort_keys=True))
