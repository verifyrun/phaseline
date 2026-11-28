import sys,json
from pathlib import Path
root=Path(sys.argv[1]);study=Path(__file__).resolve().parent
sys.path.insert(0,str(study))
from reader import read
from manifests import retrieve
used=set()
for other in root.glob('*/openings.json'):
    if other.parent.name not in sys.argv[3:]: used.update(json.loads(other.read_text()))
if (root/'openings.json').exists(): used.update(json.loads((root/'openings.json').read_text()))
first={}
for group in sys.argv[3:]:
    d=root/group
    data=json.loads((d/'openings.json').read_text())
    dates=json.loads((d/'opening-dates.json').read_text())
    assert set(dates)==set(data)
    for k,v in data.items():
        assert k not in first and k not in used
        a=read({**v,'projectFiles':retrieve(v,dates[k])},'editor')
        assert a['action']=='advance' or (a['action']=='ask' and a['question'] and a['field'])
        first[k]=a
    print(group,len(data))
assert first
(study/sys.argv[2]).write_text(json.dumps(first,indent=2,sort_keys=True)+'\n')
