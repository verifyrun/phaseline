import subprocess,json,hashlib
from pathlib import Path
def gh(*args):return json.loads(subprocess.check_output(['gh','api',*args]))
def issues(label,n):return gh('-X','GET','search/issues','-f','q=repo:Textualize/rich is:issue is:closed created:<2024-01-01 label:'+label,'-f','sort=created','-f','order=asc','-f','per_page='+str(n))['items']
maybe=issues('"more information needed"',10); skip={x['number'] for x in maybe}
controls=[x for x in issues('bug',15) if x["number"] not in skip][:4]
rows={};mapping={}
for item in maybe+controls:
 key=hashlib.sha256(('verdict-blind-'+str(item['number'])).encode()).hexdigest()[:12]
 rows[key]={'title':item['title'],'body':item['body'] or ''};mapping[key]=item['number']
Path('rich-inputs.json').write_text(json.dumps(rows,sort_keys=True))
Path('rich-seal.json').write_text(json.dumps(mapping,sort_keys=True))
print(len(rows),'case prefixes sealed')
