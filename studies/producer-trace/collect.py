"""Examiner. Only openings are handed to the predictor. Never run commands from a report."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

def gh(*args):
    return json.loads(subprocess.check_output(["gh","api",*args]))

def first_body(repo, number, before):
    owner,name = repo.split("/")
    query = '''query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){issue(number:$n){
      title body createdAt lastEditedAt timelineItems(first:1,itemTypes:[RENAMED_TITLE_EVENT]){totalCount}
      userContentEdits(first:100){nodes{editedAt diff} totalCount}}}}'''
    row=gh("graphql","-f","query="+query,"-f","owner="+owner,"-f","name="+name,"-F","n="+str(number))["data"]["repository"]["issue"]
    if row["timelineItems"]["totalCount"]: return None
    if row["lastEditedAt"] is None: return row["title"],row["body"],row["createdAt"]
    edits=row["userContentEdits"]
    if edits["totalCount"]>len(edits["nodes"]): return None
    originals=[e for e in edits["nodes"] if e["diff"] and e["editedAt"]==row["createdAt"] and e["editedAt"]<before]
    if len(originals)!=1: return None
    return row["title"],originals[0]["diff"],originals[0]["editedAt"]

if __name__=="__main__":
    repo="prettier/prettier-vscode"
    role={"OWNER","MEMBER","COLLABORATOR"}
    def select(i):
        if i["user"]["type"]=="Bot" or i["author_association"] in role or re.search("security|exploit|vulnerability",i["title"],re.I): return
        cs=gh(f'repos/{repo}/issues/{i["number"]}/comments?per_page=100')
        for j,m in enumerate(cs):
            if m["user"]["type"]=="Bot" or m["author_association"] not in role or len(m["body"].strip())<12: continue
            f=next((a for a in cs[j+1:] if a["user"]["login"]==i["user"]["login"]),None)
            if not f: return
            opening=first_body(repo,i["number"],m["created_at"])
            if not opening:return
            return i["number"],opening,m,f,cs[j+1:]
    dates=sys.argv[2] if len(sys.argv)>2 else "2022-01-01..2023-12-31"
    qualifier=" commenter:ntotten" if dates=="2019-01-01..2019-12-31" else ""
    groups=[0,0]; briefs={}; key={}; scanned=0
    for page in (1,2):
        items=gh("-X","GET","search/issues","-f","q=repo:"+repo+" is:issue is:closed comments:>=3 created:"+dates+qualifier,"-f","sort=created","-f","order=asc","-f","per_page=100","-f","page="+str(page))["items"]
        for i in range(0,len(items),8):
            if scanned>=120 or min(groups)>=6:break
            batch=items[i:i+min(8,120-scanned)];scanned+=len(batch)
            with ThreadPoolExecutor(4) as pool: rows=list(pool.map(select,batch))
            for row in rows:
                if not row:continue
                n,(title,body,date),m,f,later=row
                g=int(bool(re.search(r'\?|please (?:provide|share|post|attach|confirm|show|give)',m["body"],re.I)))
                if groups[g]>=6:continue
                groups[g]+=1
                ident=hashlib.sha256(f"cold-producer-{n}".encode()).hexdigest()[:16]
                briefs[ident]={"title":title,"body":re.sub(r'https://github\.com/prettier/prettier-vscode/issues/'+str(n)+r'(?!\d)',"[this issue]",body)}
                key[ident]={"issue":n,"opening_at":date,"maintainer":m,"reporter":f,"later":later}
        if scanned>=120 or min(groups)>=6:break
    out=Path(sys.argv[1])
    (out/"opening-dates.json").write_text(json.dumps({k:v["opening_at"] for k,v in key.items()}))
    (out/"openings.json").write_text(json.dumps(briefs,sort_keys=True))
    (out/"sealed-human.json").write_text(json.dumps(key,sort_keys=True))
    print("Openings selected:",len(briefs),"from",scanned)
