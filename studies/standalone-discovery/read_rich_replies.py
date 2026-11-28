import subprocess,json
from pathlib import Path
for key,n in json.load(open('rich-seal.json')).items():
 repo='Textualize/rich'
 issue=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/issues/{n}']))
 comments=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/issues/{n}/comments?per_page=100']))
 print('\nISSUE',n,issue["title"])
 for i,c in enumerate(comments):
  who="OP" if c['user']['login']==issue['user']['login'] else c['author_association']
  if c['user']['type']!='Bot':print(who,c['html_url'].split('#')[-1],c['body'].replace('\n',' ')[:515])
