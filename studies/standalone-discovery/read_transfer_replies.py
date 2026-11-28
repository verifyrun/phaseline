import concurrent.futures,json,subprocess
from pathlib import Path
def gh(path):
 return json.loads(subprocess.check_output(['gh','api',path]))
def fetch(n):
 path=f'repos/Textualize/rich/issues/{n}'
 issue=gh(path); replies=gh(path+'/comments?per_page=100')
 return n,issue['title'],issue['user']['login'],replies
numbers=list(json.loads(Path('transfer-seal.json').read_text()).values())
with concurrent.futures.ThreadPoolExecutor(4) as pool:
 for n,title,author,replies in sorted(pool.map(fetch,numbers)):
  rs=[c for c in replies if c['user']['type']!='Bot']
  ms=[(i,c) for i,c in enumerate(rs) if c['author_association'] in ('OWNER','MEMBER','COLLABORATOR') and c['user']['login']!=author]
  print(n,title)
  if ms:
   i,m=ms[0]; print(' MAINT',m['id'],m['body'].replace('\r',' ').replace('\n',' ')[:420])
   nm=ms[1:] 
   if nm:print(' NEXT',nm[0][1]['body'].replace('\n',' ')[:180])
   ar=next((c for c in rs[i+1:] if c['user']['login']==author),None)
   if ar:print(' OP',ar['id'],ar['body'].replace('\n',' ')[:230])
  else:print(' NO MAINTAINER')
