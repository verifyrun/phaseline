"""Counterfactual oracle via Black's CLI parser, independent of Black.Mode and Phaseline."""
from itertools import product
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import black
from click.testing import CliRunner

folder=Path(sys.argv[1])
source=json.loads((folder/"fixtures.json").read_text())
sample=json.loads((folder/(black.__version__+".json")).read_text())["results"]
runner=CliRunner()
count=errors=0
with TemporaryDirectory() as tmp:
    config=Path(tmp)/"blank.toml"
    config.write_text("")
    for case,text in source.items():
        for idx,(strings,commas,width) in enumerate(product((False,True),repeat=3)):
            flags=["--config",str(config),"--quiet","--line-length","80" if width else "88"]
            if strings: flags.append("--skip-string-normalization")
            if commas: flags.append("--skip-magic-trailing-comma")
            result=runner.invoke(black.main,[*flags,"-"],input=text)
            expected=sample[case][idx]
            if isinstance(expected,str):
                assert result.exit_code==0 and result.stdout_bytes==expected.encode(),(case,flags,result.exit_code)
            else:
                assert result.exit_code!=0,(case,flags,"expected a formatter error")
                errors+=1
            count+=1
print(black.__version__,count,"CLI grid comparisons agreed;",errors,"matched errors")
