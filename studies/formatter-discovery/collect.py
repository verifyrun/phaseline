"""Examiner only: select eligible exchanges without revealing later answers to the reader."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys

REPO="psf/black"
def api(path,*args):
    return json.loads(subprocess.check_output(["gh","api","-X","GET",path,*args]))
def select(item):
    if item["user"]["type"]=="Bot" or item["author_association"] in ("OWNER","MEMBER","COLLABORATOR"):
        return None
    if re.search(r"security|exploit|vulnerability",item["title"],re.I):return None
    comments=api(f'repos/{REPO}/issues/{item["number"]}/comments?per_page=100')
    for i,c in enumerate(comments):
        if c["user"]["type"]=="Bot" or c["author_association"] not in ("OWNER","MEMBER","COLLABORATOR") or len(c["body"].strip())<12:continue
        follow=[r for r in comments[i+1:] if r["user"]["login"]==item["user"]["login"]]
        if not follow:return None
        group=int(bool(re.search(r'\?|please (?:provide|share|post|attach|confirm|show|give)',c["body"],re.I)))
        return group,item,c,follow[0],comments[i+1:]
    return None

if __name__=="__main__":
    skip=set()
    group_counts=[0,0]; briefs={}; gold={}; scanned=0
    dates = sys.argv[1] if len(sys.argv)>1 else "2024-01-01..2025-12-31"
    query="repo:psf/black is:issue is:closed comments:>=3 created:"+dates
    for page in (1,2):
        items=api('search/issues','-f','q='+query,'-f','sort=created','-f','order=asc','-f','per_page=100','-f','page='+str(page))['items']
        for chunk in range(0,len(items),8):
            if min(group_counts)>=6 or scanned>=120:break
            batch=[i for i in items[chunk:chunk+8] if i['number'] not in skip][:120-scanned];scanned+=len(batch)
            with ThreadPoolExecutor(4) as pool:found=list(pool.map(select,batch))
            for row in found:
                if not row: continue
                group,item,m,f,later=row
                if group_counts[group]>=6:continue
                group_counts[group]+=1
                key=sha256(('hidden-reporter.'+str(item['number'])).encode()).hexdigest()[:16]
                briefs[key]={'title':item['title'],'body':item['body'] or ''}
                gold[key]={'issue':item['number'],'maintainer':m,'reporter':f,'later':later}
        if min(group_counts)>=6 or scanned>=120:break
    Path('positive-inputs.json').write_text(json.dumps(briefs,sort_keys=True))
    Path('positive-private-key.json').write_text(json.dumps(gold,sort_keys=True))
    print("Selected",sum(group_counts),"issues; later replies held by the examiner.")
