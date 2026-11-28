"""Examiner-only setup of a local consuming workspace, with no modification to the user's editor."""
import json
from pathlib import Path
import random
import sys

root=Path(sys.argv[1]).resolve()
version=sys.argv[2]
v2=version=="11.0.0"
work=root/"product"
work.mkdir(exist_ok=True)
config={"folders":[],"settings":{"extensions.autoUpdate":False,"editor.formatOnSave":False,"typescript.tsserver.log":"verbose","files.autoSave":"off","workbench.startupEditor":"none"}}
consumer=["bundled","same-release","new-release","builtin"]*3
random.Random(554620+int(v2)).shuffle(consumer)
secrets={}
for i,route in enumerate(consumer):
    name=f"part-{i:02d}"
    sub=work/name
    sub.mkdir(exist_ok=True)
    (sub/".vscode").mkdir(exist_ok=True)
    project_file=sub/"sample.js"
    if v2:
        previous=json.loads((root/"host-10.4.0"/"observations.json").read_text())[name]["after"]
        assert previous==project_file.read_text()
        src=previous+("const retained = true;\n" if i%3==0 else "const updated=longFunction(firstLongArgument,secondLongArgument,thirdLongArgument);\n")
    else:
        src=["const n = 1;\n","const n=1;\n","const n=longFunction(firstLongArgument,secondLongArgument,thirdLongArgument);\n"][i%3]
    project_file.write_text(src)
    settings={"[javascript]":{"editor.defaultFormatter":"vscode.typescript-language-features" if route=="builtin" else "esbenp.prettier-vscode"}}
    if route in ("same-release","new-release"):
        engine="2.8.8" if route=="same-release" else "3.3.3"
        settings["prettier.prettierPath"]=str(root/("engine-"+engine)/"node_modules/prettier")
    (sub/".vscode"/"settings.json").write_text(json.dumps(settings))
    (sub/".prettierrc.json").write_text('{"printWidth":35}')
    config["folders"].append({"path":name})
    secrets[name]=route
(work/"lab.code-workspace").write_text(json.dumps(config))
(root/("host-"+version)/"examiner.json").write_text(json.dumps(secrets))
