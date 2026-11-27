#!/usr/bin/env node
import {copyFileSync, mkdirSync, readFileSync as readBytes} from "node:fs";
import {join} from "node:path";
import {compareContracts, decide, diagramDifference, enumeratedDifference} from "./evidence-source.mjs";
import {introducedInputs} from "./source-feedback.mjs";

import {analyze} from "./inquiry.mjs";

import {readJSON as parseJSON} from "./exact-json.mjs";
import {makeBook, captureRecord, carryRecord} from "./carry.mjs";
import {retain, challenge} from "./retention.mjs";

const help = [
  "Start with a question about your evidence or a proposed change.",
  "phaseline check recipients POLICY.json PROPOSAL.json   compare proposed identities against receiver-pinned installed rules",
  "phaseline observe sqlite DB --views OLD_VIEW NEW_VIEW TERMS.json   check the two installed SQLite views",
  "phaseline observe sqlite DB OLD.sql NEW.sql TERMS.json   read both editions on one authorized snapshot and compare recipients",
  "phaseline init DIRECTORY [inquiry|plant|course|plans|retention|carry|knowledge|archive|receiver]   create a new working directory",
  "phaseline compare [--solver z3|diagram|enumerate] OLD.phase NEW.phase    print changed guarantees and witnesses",
  "phaseline compare --machines OLD.json NEW.json   compare two deterministic transition editions from their origins",
  "phaseline compare --machines OLD.json NEW.json --wallet any|N   least or exact funded observable difference",
  "phaseline check [--solver z3|diagram|enumerate] OLD.phase NEW.phase      exit 0 preserved, 2 review, 1 error",
  "phaseline decide [--explain] [--gate GUARANTEE] RULES.phase CASE.json   evaluate a subject; --explain also counts records from undeclared sources; --gate exits 2 unless GUARANTEE is released",
  "", "Evidence, observers and future actions",
  "phaseline analyze RULES.phase OBSERVER.phase HISTORIES.json   distinguish histories with the declared observations",
  "phaseline knowledge RULES.phase SYSTEM.json ROLE [TRACE.json | --plan DEMANDS.json]   check knowledge, follow records or price a sequence",
  "phaseline knowledge --sequence SOURCE.json [TERMS.json]   construct a strong plan with no observation-dependent choices",
  "phaseline knowledge --synthesize SOURCE.json [TERMS.json]   construct and verify a signal-only controller",
  "phaseline knowledge --policy SOURCE.json CONTROLLER.json [TERMS.json]   verify a proposed policy from public signals",
  "phaseline knowledge RULES.phase SYSTEM.json ROLE --achieve TASK.json   find a funded policy for every admitted outcome",
  "phaseline encode RULES.phase MODEL.json CASE.json   obtain a finite-variable code from source-bound observations",
  "phaseline retain RULES.phase REGIME.json [REVISED.phase]   minimize retained distinctions and check migration",
  "phaseline retain --one-later RELATION.json [LIMITS.json]   least records when a future question can buy one reading",
  "phaseline retain --fields RULES.phase REGIME.json [LIMITS.json]   cheapest fixed observations for this regime",
  "phaseline retain --records TABLE.json [LIMITS.json]   cheapest fixed observations on a correlated finite table",
  "phaseline retain --read TABLE.json QUERIES.json [LIMITS.json]   look up complete observations from the supplied table",
  "phaseline challenge --inputs CONTRACT.json [SIGNED.json | --offset N]   test what a raw input projection can forget",
  "phaseline challenge RULES.phase REGIME.json TRACE.json   check a separately recorded sequence",
  "phaseline challenge RULES.phase REGIME.json --coverage CONTRACT.json [SIGNED-RESULTS.json]   plan or assess a bounded receiver test",
  "", "Issue and transfer records",
  "phaseline book RULES.phase REGIME.json   create a versioned codebook",
  "phaseline capture BOOK.json CASE.json   obtain a code from available records",
  "phaseline carry OLD-BOOK.json NEW-BOOK.json RECEIPT.json BRIDGE.json TRUST.json CASE.json   check a carry across regimes",
  "Enroll named topics to keep separate owner decisions. Use check_joint for their observations on one released snapshot.",
  "A project can suggest_question, answer_question, recover question_status and check_decision on its actual receiver.",
  "phaseline handoff open ACCOUNT.sqlite ROOT.json GRANT.json   enroll one funded native review session",
  "phaseline handoff step ACCOUNT.sqlite REQUEST.json [--recover]   advance an authorized handoff or reconcile a lost response",
  "  Dictionary return: pack_dictionary, route_dictionary, deliver_dictionary, record_dictionary",
  "phaseline serve [--port N]   answer decide and compare requests from programs on this computer",
  "phaseline --version"
].join("\n");
// The everyday commands. phaseline --help all prints every command.
const common = [
  "Phaseline checks rule changes and decides from records. Start here:",
  ...help.split("\n").filter(line => /^phaseline (init|observe sqlite DB OLD|compare \[|check|decide|analyze|retain RULES)/.test(line)),
  "phaseline --help all   list every command",
  "phaseline --version",
  "Exit codes: 0 done, 2 needs review or cannot release, 1 mistaken command or unreadable input."
].join("\n");
const [command, ...args] = process.argv.slice(2);

// Name the file in every read and parse error.
const names = new Map();
function readFileSync(path, encoding) {
  if (path instanceof URL) return readBytes(path, encoding);
  try {
    const text = readBytes(path, encoding);
    names.set(text, path);
    return text;
  } catch (error) {
    throw Error(error.code === "ENOENT" ? "No file at " + path + "." : error.code === "EISDIR" ? path + " is a directory. Name a file."
      : "Cannot read " + path + (error.code ? " (" + error.code + ")." : "."));
  }
}
function readJSON(text) {
  try { return parseJSON(text); } catch (error) {
    const name = names.get(text) ?? "The input";
    if (error instanceof SyntaxError) throw Error(name + " is not valid JSON.");
    if (error instanceof RangeError) throw Error(name + " is nested too deeply.");
    throw Error(name + ": " + error.message);
  }
}
function usage() {
  const lines = help.split("\n").filter(line => line.startsWith("phaseline " + command + " "));
  return Error(lines.length ? "Usage:\n" + lines.join("\n") + "\nRun phaseline --help all for every command."
    : "Unknown command: " + command + ". Run phaseline --help all for every command.");
}
try {
  if ((command === "--help" || command === "-h") && args[0] === "all") {
    console.log(help);
  } else if (command === "--help" || command === "-h" || !command) {
    console.log(common);
  } else if (command === "check" && args[0] === "recipients") {
    if (args.length !== 3) throw usage();
    const {checkSqliteRecipients} = await import("./sqlite-observation.mjs");
    let policy = null;
    try { policy = readJSON(readBytes(args[1], "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const result = checkSqliteRecipients(policy, readJSON(readFileSync(args[2], "utf8")));
    console.log(JSON.stringify(result));
    if (result.status !== "matched") process.exitCode = 2;
  } else if (command === "observe" && args[0] === "sqlite") {
    const views = args[2] === "--views";
    if (args.length !== (views ? 6 : 5)) throw usage();
    const {observeSqlite, observeSqliteViews} = await import("./sqlite-observation.mjs");
    const [before, after, file] = args.slice(views ? 3 : 2);
    const terms = readJSON(readFileSync(file, "utf8"));
    const result = views ? observeSqliteViews(args[1], before, after, terms)
      : observeSqlite(args[1], readFileSync(before, "utf8"), readFileSync(after, "utf8"), terms);
    console.log(JSON.stringify(result));
    if (!["observed", "matched"].includes(result.status)) process.exitCode = 2;
  } else if (command === "serve" && (args.length === 0 || (args.length === 2 && args[0] === "--port"))) {
    const port = args.length ? Number(args[1]) : 8787;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw usage();
    const {serve} = await import("./serve.mjs");
    const server = await serve(port);
    console.log(JSON.stringify({status: "listening", url: "http://127.0.0.1:" + server.address().port}));
  } else if (command === "--version") {
    console.log(JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).version);
  } else if (command === "init" && (args.length === 1 || args.length === 2)) {
    const sample = args[1] ?? "inquiry";
    if (!["inquiry","plant","course","plans","retention","carry","knowledge","archive","receiver"].includes(sample)) throw usage();
    const samples = sample === "receiver" ? ["policy.phase","model.json","terms.json","observed.json","misrouted.json"] : sample === "archive" ? ["rules.phase","model.json","case.json","trace.json"] : sample === "knowledge" ? ["rules.phase","system.json","trace.json","demands.json"] : sample === "carry" ? ["old.phase","new.phase","old.json","new.json","at-issue.json","at-review.json","bridge.json","trust.json"] : sample === "retention" ? ["issued.phase","proposed.phase","regime.json","trace.json"] : ["issued.phase", "proposed.phase", "records.json", "observer.phase", "histories.json"];
    mkdirSync(args[0]);
    for (const name of samples) {
      copyFileSync(new URL(sample + "-" + name, import.meta.url), join(args[0], name));
    }
    console.log("Created "+samples.join(", ")+" in "+args[0]);
  } else if (command === "handoff") {
    const {fundedCommand}=await import("./review-cli.mjs");
    const result=await fundedCommand(args);
    console.log(JSON.stringify(result,null,2));
    if (["hold","different","occurrence_unknown","delivery_absent","delivery_superseded","historical_plan","over_budget","unachievable","withdrawal_pending","withdrawal_disputed","port_unknown","observed_change","needs_observation","intent_mismatch","question_open","release_withheld"].includes(result.status)) process.exitCode=2;
  } else if (command === "book" && args.length === 2) {
    console.log(JSON.stringify(await makeBook(readFileSync(args[0],"utf8"),readJSON(readFileSync(args[1],"utf8"))), null, 2));
  } else if ((command === "capture" && args.length === 2) || (command === "carry" && args.length === 6)) {
    const inputs = args.map(path => readJSON(readFileSync(path,"utf8")));
    const result = command === "capture" ? await captureRecord(...inputs) : await carryRecord(...inputs);
    console.log(JSON.stringify(result,null,2));
    if (result.status === "hold") process.exitCode = 2;
  } else if (["compare","check"].includes(command) && args[0] === "--machines" && (args.length === 3 || (args.length === 5 && args[3]==="--wallet"))) {
    const {compareMachines}=await import("./machine-comparison.mjs");
    const [issued,proposed]=args.slice(1,3).map(path=>readJSON(readFileSync(path,"utf8")));
    const result=args.length===5
      ? (await import("./priced-machines.mjs")).comparePricedMachines(issued,proposed,args[4])
      : compareMachines(issued,proposed);
    console.log(JSON.stringify(result,null,2));
    if (result.status==="hold" || (command==="check" && result.status==="changed")) process.exitCode=2;
  } else if(command==="encode" && args.length===3) {
    const {symbolicEncode}=await import("./symbolic-retention.mjs");
    const [source,model,packet]=args.map(p=>readFileSync(p,"utf8"));
    const result=symbolicEncode(source,readJSON(model),readJSON(packet));
    console.log(JSON.stringify(result,null,2));
    if(result.status!=="encoded") process.exitCode=2;
  } else if (command === "challenge" && args[0] === "--inputs") {
    const {rawInterface,rawSchedule,assessRaw}=await import("./raw-inputs.mjs");
    const load=path=>readJSON(readFileSync(path,"utf8"));
    const contract=await rawInterface(load(args[1]));
    let result;
    if (args.length===2) result=rawSchedule(contract);
    else if (args.length===3) result=await assessRaw(contract,load(args[2]));
    else if (args.length===4 && args[2]==="--offset" && /^[0-9]{1,160}$/.test(args[3]))
      result=rawSchedule(contract,256,BigInt(args[3]));
    else throw usage();
    console.log(JSON.stringify(result,null,2));
    if (!["planned","conditionally_sufficient"].includes(result.status)) process.exitCode=2;
  } else if (command === "challenge" && args[2] === "--coverage" && (args.length === 4 || args.length === 5)) {
    const {prepareConformance,assessConformance}=await import("./conformance.mjs");
    const jsonFile=path=>readJSON(readFileSync(path,"utf8"));
    const prepared=await prepareConformance(readFileSync(args[0],"utf8"),jsonFile(args[1]),jsonFile(args[3]));
    const result=args.length===5 ? await assessConformance(prepared,jsonFile(args[4])) : prepared.plan;
    console.log(JSON.stringify(result,null,2));
    if (!["planned","conditionally_conformant"].includes(result.status)) process.exitCode=2;
  } else if (command === "challenge" && args.length === 3) {
    const [rules, model, trace] = args.map(path => readFileSync(path,"utf8"));
    const result = challenge(rules,readJSON(model),readJSON(trace));
    console.log(JSON.stringify(result,null,2));
    if (result.status === "inconsistent") process.exitCode = 2;
  } else if (command==="retain" && args[0]==="--one-later" && (args.length===2 || args.length===3)) {
    const {oneLater}=await import("./one-later.mjs");
    const load=path=>readJSON(readFileSync(path,"utf8"));
    const result=oneLater(load(args[1]),args[2]?load(args[2]):{});
    console.log(JSON.stringify(result,null,2));
    if(result.status!=="minimum")process.exitCode=2;
  } else if (command === "retain" && ["--fields","--records","--read"].includes(args[0])) {
    const {retainedFields,regimeTable,readRecordBatch}=await import("./record-fields.mjs");
    const [mode,...files]=args;
    const required=mode==="--records"?1:2;
    if (files.length<required || files.length>required+1) throw usage();
    const json=path=>readJSON(readFileSync(path,"utf8"));
    const terms=files[required]?json(files[required]):{};
    const table=mode==="--fields"?regimeTable(readFileSync(files[0],"utf8"),json(files[1])):json(files[0]);
    const result=mode==="--read"?readRecordBatch(table,json(files[1]),terms):retainedFields(table,terms);
    console.log(JSON.stringify(result,null,2));
    if (!["minimum","read"].includes(result.status)) process.exitCode=2;
  } else if (command === "retain" && (args.length === 2 || args.length === 3)) {
    const [issued, model, revised] = args.map(path => readFileSync(path,"utf8"));
    console.log(JSON.stringify(retain(issued, readJSON(model), revised),null,2));
  } else if(command==="knowledge" && args[0]==="--sequence" && (args.length===2 || args.length===3)) {
    const {constructSequence}=await import("./conformant-planner.mjs");
    const json=path=>readJSON(readFileSync(path,"utf8"));
    const result=constructSequence(json(args[1]),args[2]?json(args[2]):{});
    console.log(JSON.stringify(result,null,2));
    if(result.status!=="certified_policy")process.exitCode=2;
  } else if(command==="knowledge" && args[0]==="--synthesize" && (args.length===2 || args.length===3)) {
    const {constructPhysical}=await import("./physical-planner.mjs");
    const json=path=>readJSON(readFileSync(path,"utf8"));
    const result=constructPhysical(json(args[1]),args[2]?json(args[2]):{});
    console.log(JSON.stringify(result,null,2));
    if(result.status!=="certified_policy")process.exitCode=2;
  } else if (command === "knowledge" && args[0]==="--policy" && (args.length===3 || args.length===4)) {
    const {certifyPolicy}=await import("./policy-certificate.mjs");
    const load=path=>readJSON(readFileSync(path,"utf8"));
    const result=certifyPolicy(load(args[1]),load(args[2]),args[3]?load(args[3]):{});
    console.log(JSON.stringify(result,null,2));
    if (result.status!=="certified_policy") process.exitCode=2;
  } else if (command === "knowledge" && args.length===5 && args[3]==="--achieve") {
    const {planControl}=await import("./control.mjs");
    const source=readFileSync(args[0],"utf8");
    const jsonFile=path=>readJSON(readFileSync(path,"utf8"));
    const verdict=planControl(source,jsonFile(args[1]),args[2],jsonFile(args[4]));
    console.log(JSON.stringify(verdict,null,2));
    if(verdict.status!=="within_budget") process.exitCode=2;
  } else if (command === "knowledge" && (args.length===3 || args.length===4 || (args.length===5 && args[3]==="--plan"))) {
    const {knowledge,planKnowledge}=await import("./knowledge.mjs");
    const [rules,system,actor,trace]=args;
    const source=readFileSync(rules,"utf8"), definition=readJSON(readFileSync(system,"utf8"));
    const result=args.length===5
      ? planKnowledge(source,definition,actor,readJSON(readFileSync(args[4],"utf8")))
      : knowledge(source,definition,actor,trace===undefined?undefined:readJSON(readFileSync(trace,"utf8")));
    console.log(JSON.stringify(result,null,2));
    if(!["always_known","determined","within_budget"].includes(result.status)) process.exitCode=2;
  } else if (command === "analyze" && args.length === 3) {
    const [edition, observer, histories] = args.map(path => readFileSync(path,"utf8"));
    console.log(JSON.stringify(analyze(edition, observer, readJSON(histories)), null, 2));
  } else {
    let findDifference;
    if (["compare", "check"].includes(command) && args[0] === "--solver") {
      if(args[1]==="enumerate") findDifference=enumeratedDifference;
      else if(args[1]==="diagram") findDifference=diagramDifference;
      else if(args[1]==="z3") {
        const {z3Differences} = await import("./z3-compare.mjs");
        findDifference = z3Differences();
      } else throw Error("Supported explicit solvers: z3, diagram, enumerate.");
      args.splice(0,2);
    }
    let explain = false, gate;
    while (command==="decide" && ["--explain","--gate"].includes(args[0])) {
      if (args[0]==="--explain") { if (explain) throw usage(); explain = true; args.shift(); }
      else { if (gate!==undefined || args.length<2) throw usage(); gate = args[1]; args.splice(0,2); }
    }
    if (args.length !== 2 || !["compare", "check", "decide"].includes(command)) throw usage();
    const [first, second] = args.map(path => readFileSync(path, "utf8"));
    if (command === "decide") {
      const result = decide(first, readJSON(second), {explain}), actions = explain ? result.actions : result;
      if (gate!==undefined && !Object.hasOwn(actions,gate)) throw Error("Name a declared guarantee for --gate: "+gate);
      console.log(JSON.stringify(result, null, 2));
      if (gate!==undefined && actions[gate].status!=="release") process.exitCode = 2;
    } else {
      const {before, after, result, bindings} = compareContracts(first, second, findDifference);
      const review = result.changes.length > 0 || bindings.length > 0;
      const warnings = introducedInputs(before,after).filter(item=>!after.bindings.has(item.fact) && (item.previousGuarantee || item.suggestions.length));
      console.log(JSON.stringify({status: review ? "review" : "preserved", changes: result.changes, bindings,
        ...(warnings.length?{warnings}:{})}, null, 2));
      if (command === "check" && review) process.exitCode = 2;
    }
  }
} catch (error) {
  // A fault inside the checker on malformed input is reported as an input problem, without internals.
  const internal = error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError;
  console.error(JSON.stringify({status: "hold", reason: internal
    ? "An input file does not have the expected fields. Compare it with a sample from phaseline init." : error.message}));
  process.exitCode = 1;
}
