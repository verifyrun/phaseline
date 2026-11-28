import hashlib
import json
import subprocess
from pathlib import Path

query="repo:Textualize/rich is:issue is:closed bug in:title comments:>=3 created:2024-01-01..2025-12-31"
items=json.loads(subprocess.check_output(["gh","api","-X","GET","search/issues","-f","q="+query,"-f","sort=created","-f","order=asc","-f","per_page=100"]))["items"]
keep=[i for i in items if not any(w in i["title"].lower() for w in ("vulnerability","exploit","security"))][:20]
data={}; mapping={}
for item in keep:
    key=hashlib.sha256(("rich-transfer."+str(item["number"])).encode()).hexdigest()[:12]
    data[key]={"title":item["title"],"body":item["body"] or ""}
    mapping[key]=item["number"]
Path("transfer-inputs.json").write_text(json.dumps(data,sort_keys=True))
Path("transfer-seal.json").write_text(json.dumps(mapping,sort_keys=True))
print(len(keep),"new issues")
