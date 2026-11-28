"""Collect historical diagnostics. Only pre-2024 Black threads enter the reader's reference library."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import re
import sys
from collect import api,select
rows=[]
for page in range(1,3):
    items=api("search/issues","-f","q=repo:psf/black is:issue is:closed comments:>=3 created:2022-01-01..2023-12-31","-f","sort=created","-f","order=desc","-f","per_page=60","-f","page="+str(page))["items"]
    with ThreadPoolExecutor(4) as pool:
        for row in pool.map(select,items):
            if not row: continue
            _,item,reply,_,_=row
            sentences=re.split(r"(?<=[.?!])\s+|\n+",reply["body"].strip())
            question=next((s for s in sentences if "?" in s and re.search(r'\b(can you|could you|did you|which|what (?:version|is|does)|does (?:it|this|the)|are you|do you)\b',s,re.I) and len(s)<320),None)
            rows.append({"issue":item["number"],"title":item["title"],"body":item["body"] or "","question":question})
Path(sys.argv[1]).write_text(json.dumps(rows,sort_keys=True))
print(len(rows),"historical precedents")
