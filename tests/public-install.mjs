// Exercise the actual public instructions, including a runtime install without dev dependencies.
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const instructions = [...readme.matchAll(/<!-- public-install: (\w+) -->\s*```sh\n([\s\S]*?)\n```/g)];
assert.deepEqual(instructions.map(match => match[1]), ["cli", "library"]);
const root = mkdtempSync(join(tmpdir(),"phaseline-public-"));
const empty = join(root,"empty.npmrc");
writeFileSync(empty,"");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(npm_config_|npm_token$|node_auth_token$|github_token$|gh_token$)/i.test(k)));
Object.assign(env, {npm_config_userconfig:empty,npm_config_globalconfig:join(root,"global.npmrc"),
  npm_config_cache:join(root,"cache"),npm_config_registry:"https://registry.npmjs.org/",
  npm_config_audit:"false",npm_config_fund:"false",npm_config_ignore_scripts:"true"});
writeFileSync(env.npm_config_globalconfig,"");
try {
  const who = spawnSync("bash", ["-c","npm whoami"], {cwd:root,env,encoding:"utf8"});
  assert.ok(who.status !== 0 && /ENEEDAUTH/.test(who.stderr), "Registry must confirm anonymous access");
  for (const [,surface,commands] of instructions) {
    const cwd = join(root,surface);
    mkdirSync(cwd);
    const output = execFileSync("bash",["-e","-c",commands], {cwd,env,encoding:"utf8"});
    const manifest = JSON.parse(readFileSync(join(cwd,"package.json")));
    const cli = join(cwd,"node_modules","@verifyrun","phaseline","phase.mjs");
    const version = execFileSync(process.execPath,[cli,"--version"],{cwd,env,encoding:"utf8"}).trim();
    assert.equal(version,(manifest.dependencies ?? manifest.devDependencies)["@verifyrun/phaseline"]);
    const decide = (...args) => spawnSync(process.execPath,[cli,"decide",...args],{cwd,env,encoding:"utf8"});
    const files = ["inquiry/proposed.phase","inquiry/records.json"];
    const result = decide(...files);
    assert.equal(result.status,0,result.stderr);
    const answers = JSON.parse(result.stdout);
    assert.equal(answers.rely.status,"hold");
    assert.equal(answers.rely.needs[0].owner,"reviewer");
    assert.equal(answers.retain_record.status,"release");
    if (surface === "library") {
      assert.equal(output.trim().split(/\r?\n/).at(-1),"false");
      execFileSync("bash",["-e","-c","npm ci --omit=dev"],{cwd,env});
      assert.equal(decide("--gate","rely",...files).status,2);
      assert.equal(decide("--gate","retain_record",...files).status,0);
      // Fresh process, installed rules, original clocks. Later training cannot authorize an earlier event.
      writeFileSync(join(cwd,"standing.phase"),"fact trained from hr.training owner hr standing at event\nguarantee assign when trained\n");
      for (const [at,expected] of [[4,0],[6,2]]) {
        writeFileSync(join(cwd,"case.json"),JSON.stringify({subject:"worker",at:5,asOf:8,records:[
          {subject:"worker",at,recorded:7,source:"hr.training",by:"hr",value:true}]}));
        assert.equal(decide("--gate","assign","standing.phase","case.json").status,expected);
      }
    }
    console.log(surface,version,"passed");
  }
} finally {
  rmSync(root,{recursive:true,force:true});
}
