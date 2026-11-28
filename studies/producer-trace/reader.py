"""Select one next triage action from the opening and any independently recovered project files."""
import json
import re
import sys
from pathlib import Path

def read(report, project):
    title=report["title"]
    body=re.sub(r"<!--.*?-->", "",report["body"],flags=re.S).replace("\r\n","\n")
    text=title+"\n"+body
    def ask(field,question,evidence):
        return {"action":"ask","field":field,"question":question,"evidence":evidence}
    def advance(reason):
        return {"action":"advance","evidence":reason}
    if re.search(r'\b(?:feature request|suggestion|proposal)\b|^\s*(?:please )?(?:add|support|allow)\b',title,re.I):
        return advance("An owner can evaluate the proposed feature from this opening.")
    if re.search(r'ModuleNotFoundError|No module named|module no[t]? found|missing dependency',text,re.I):
        if re.search(r'now .*(?:loads|works)|no[w ]+issue',body,re.I) and re.search(r'vim|editor',body,re.I):
            return ask("owner","Which part of the editor integration should locate or install the package for its own interpreter?","The report already identifies different editor and install interpreters and confirms a working repair.")
        if re.search(r'pipenv run|poetry run|/virtualenvs/|site-packages',body,re.I):
            return ask("installer","Which install command populated the environment whose executable appears in this failing run?","A launcher and import traceback identify the runtime. They do not establish the installation procedure.")
    if re.search(r'/docs/|documentation',body,re.I) and re.search(r'replac(?:e|ing).{0,130}(?:resolved|fix)|example.*(?:wrong|outdated)',body,re.I):
        return ask("document","Which exact documentation page or example still supplies the failing configuration?","The opening already contains the corrected configuration; its remaining source is the question.")
    if re.search(r'inconsistent|sometimes|intermittent',text,re.I) and re.search(r'different (?:users|commit)|same directory|same file',body,re.I):
        return ask("reproduction","Can you show one exact source example and the invocation in which the tool introduces the reported change?","An aggregate or intermittent result does not identify the transformation on an individual file.")
    if (re.search(r'not equivalent|invalid code|internal error',body,re.I) or ('--- src' in body and '+++ dst' in body)) and re.search(r'(?:replicable|reproducible|repro).{0,35}(?:master|main)',body,re.I):
        return ask("revision","Does the same input still fail on the current revised build, and which exact revision did you run?","A moving branch name does not identify the revised installation.")

    log=bool(re.search(r'\[(?:["\']?)(?:INFO|DEBUG|ERROR|WARN)(?:["\']?)\s*[-\]]',body,re.I))
    completed=bool(re.search(r'Formatting completed in \d+ms',body))
    actual_module=re.search(r'"modulePath"\s*:\s*"[^"]+"|Using bundled version of prettier',body,re.I)
    project_files=report.get("projectFiles",{})
    if project_files:
        context=" Historical project manifest or settings recovered."
    else:
        context=""
    if project=="editor":
        # Find the operation at issue before asking for a trace of the formatting operation.
        if re.search(r'\bcpu\b|high memory|memory leak',title,re.I):
            return ask("process","Which process consumes the resource when the symptom appears?","An extension log cannot identify which process is consuming CPU or memory.")
        if re.search(r'uninstalled|disappeared|missing extension',title,re.I):
            return ask("installed_files","Is the extension present in the affected editor profile’s extension directory after restart?","Installed files distinguish removal from activation failure.")
        dep=re.search(r'(?:trouble getting|cannot find module|failed to load module)\s+[\x22\x27`]?([\w@./-]+)',body,re.I)
        if dep and re.search(r'installed globally|global(?:ly)? install',body,re.I):
            return ask("workspace_dependency","Is "+dep[1]+" installed in this workspace, and where does the project resolve it?","A global installation does not establish workspace resolution.")
        if re.search(r'not (?:there|listed|a recognized (?:setting|option))|unrecognized (?:setting|option)',body,re.I) and re.search(r'option|setting',title,re.I):
            return ask("option_owner","Which installed extension or tool defines that option in its settings schema?","An unrecognized option can belong to a different extension.")
        if re.search(r'using bundled',body,re.I) and re.search(r'failed to load|resolved?|hoist',body,re.I):
            return advance("The report supplies the failed lookup and bundled fallback. Reproduce that resolver path.")
        if re.search(r'unknown file extension|unexpected token',body,re.I) and re.search(r'(?:extension|VS Code) Version',body,re.I) and re.search(r'config|activation',title,re.I):
            return advance("The loader names the unsupported syntax or file type and the report identifies an edition to reproduce.")
        if re.search(r'^update.*(?:readme|docs)|possible to|how (?:do|can|to)|^support\b',title,re.I) or re.search(r'should I (?:use npm to )?install|way I can set it up',body,re.I):
            return advance("The owner can answer this usage or documentation question from the project's published behavior.")
        if re.search(r'\.prettierrc',body,re.I) and re.search(r'"prettier\.\w+"',body) and re.search(r'settings|setting|width',title,re.I):
            return advance("Check the supplied configuration keys against the file's schema and the editor's settings schema.")
        if re.search(r'\beslint\b',body,re.I) and re.search(r'before .*?prettier|before .*?format|after .*?prettier',body,re.I):
            return ask("isolation","Does this input still change the same way with ESLint disabled and the formatter run alone?","The report contains a before/after example with more than one possible writer.")
        phrases=("Extension is disabled. No formatters will be registered","File is ignored, skipping",
                 "Your project is configured to use an outdated version of prettier","This workspace is not trusted. Using the bundled version")
        if log and any(p.lower() in body.lower() for p in phrases):
            return advance("An explicit extension diagnostic identifies the active code path."+context)
        if re.search(r'\b(cli|command line|terminal)\b',body,re.I) and re.search(r'\b(works|working|correct|same|different|fails|formats)\b',body,re.I):
            if log and actual_module and completed and project_files:
                return advance("The report supplies a CLI comparison, completed editor event, resolved installation and project evidence.")
            return ask("install","Which Prettier module path and version did VS Code actually load for that file, compared with the CLI installation?","The two entry points can resolve different modules."+context)
        if log and re.search(r'Failed to load module|Cannot find module|Error loading node module',body,re.I):
            return ask("installer","How was the referenced Prettier or plugin installed in the affected workspace?","The loader recorded a failure; a dependency declaration does not show the installation completed."+context)
        if re.search(r'save|another formatter|eslint|default formatter|format document',text,re.I) and not completed:
            return ask("provider","Which formatter handled that save? Can you show the formatter output for the affected file from that invocation?","The receiver has several providers and a setting alone does not establish which ran."+context)
        if log and actual_module and completed:
            if not project_files and not re.search(r'```(?:js|ts|javascript|typescript|html|css|json)\s*\n',body,re.I):
                return ask("reproduction","Can you share a minimal project that reproduces this result with the same file and configuration?","The provider completed but the source and effective configuration are missing.")
            return advance("The observed provider completed and enough input is supplied to start reproduction."+context)
        if not log:
            return ask("log","Can you share the Prettier output log for one affected file while reproducing the issue?","The extension's own report form identifies its event log as the source for formatter selection."+context)
        return ask("reproduction","Which minimal project and steps reproduce the behavior in the editor?","A partial extension log does not identify a runnable case."+context)
    return advance("The maintainer can investigate the supplied report; this does not authorize a release.")

if __name__=="__main__":
    data=json.loads(Path(sys.argv[1]).read_text())
    Path(sys.argv[2]).write_text(json.dumps({k:read(v,sys.argv[3]) for k,v in data.items() if v},indent=2,sort_keys=True)+"\n")
