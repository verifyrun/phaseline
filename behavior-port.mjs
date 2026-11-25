// Received answers belong to a particular running edition of a particular port.
import {exactValue} from "./exact-json.mjs";
import {exact,hash,key,need,serial} from "./review-journal.mjs";

export function validateProbe(port,inputs) {
  need(port && Array.isArray(inputs) && inputs.length>0 && inputs.length<=128,"supply one to 128 permitted raw inputs");
  const granted=new Set(port.inputs.map(serial)), asked=inputs.map(serial);
  need(asked.every(v=>granted.has(v)) && new Set(asked).size===asked.length,
    "every requested input must be distinct and belong to the approved port");
}
export function expectedRuntime(db,job) {
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_runtimes'").get();
  const row=table && db.prepare("SELECT expected FROM job_runtimes WHERE job=?").get(job);
  need(row,"the queued job did not specify an expected running implementation");
  return row.expected;
}
export function rememberRuntime(db,job,expected) {
  db.exec("CREATE TABLE IF NOT EXISTS job_runtimes(job TEXT PRIMARY KEY REFERENCES jobs(id), expected TEXT NOT NULL)");
  db.prepare("INSERT INTO job_runtimes VALUES(?,?)").run(job,expected);
}
const chunks=s=>Math.ceil(Buffer.byteLength(s,"utf8")/256);
export function behaviorCharge(db,terms,op,d) {
  if (op==="inspect" && d.inputs) return 3+d.inputs.length*terms.behaviorPort.price+chunks(serial(d.inputs));
  if (op==="record" && d.observation?.body?.behavior) return 2+chunks(serial(d.observation.body.behavior))+(terms.behaviorPort?.memory || terms.behaviorPort?.late || terms.behaviorPort?.decoder || terms.behaviorPort?.question?3:0);
  if (op==="compare_ports") {
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='port_samples'").get();
    const n=table?db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM port_samples WHERE job IN (?,?)").get(d.before,d.after).n:0;
    return 1+chunks(serial(terms.behaviorPort.inputs))+n;
  }
  return undefined;
}
function observationFrame(reading) {
  if (!reading.behavior || !Array.isArray(reading.behavior.answers)) return null;
  const {answers,...metadata}=reading.behavior;
  return hash({...reading,behavior:metadata});
}
// A null outside the observation means no answer. A null inside {value: ...}
// is an actual returned value. The typed port admits exact JSON integers.
export function validateReading(probe, observation) {
  if (!probe && observation===undefined) return;
  need(probe && observation,"behavior requires both a paid request and a receiver observation");
  const typed=probe.output==="exact-json/1";
  need(exact(observation,["port","snapshot","release","contentHash","implementation","fixed","answers"],["output"]) &&
    observation.output===probe.output && (!Object.hasOwn(probe,"output") || typed) &&
    observation.port===probe.port && key(observation.implementation) && typeof observation.fixed==="boolean" &&
    Array.isArray(observation.answers) && observation.answers.length===probe.inputs.length &&
    observation.answers.every(v=>v===null || (typed?exact(v,["value"]) && exactValue(v.value):typeof v==="boolean")) &&
    (!typed || Buffer.byteLength(serial(observation.answers))<=262144),"received behavior does not match the enrolled output contract");
}
// A changed assertion about the edition or snapshot affects every sample. When
// only one Boolean answer changed, the receiver still agrees on the other rows.
export function disputeBehavior(db,ticket,reading) {
  if (!ticket.behavior)return;
  const available=db.prepare("SELECT 1 FROM sqlite_master WHERE name='port_samples' AND type='table'").get();
  const sample=available && db.prepare("SELECT rows,frame FROM port_samples WHERE pulse=?").get(ticket.pulse);
  if (!sample) {
    db.exec("CREATE TABLE IF NOT EXISTS port_unlocalized(pulse TEXT PRIMARY KEY)");
    db.prepare("INSERT OR IGNORE INTO port_unlocalized VALUES(?)").run(ticket.pulse);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='port_memories' AND type='table'").get())
      db.prepare("UPDATE port_memories SET invalid=1 WHERE pulse=?").run(ticket.pulse);
    return;
  }
  const sameFrame=sample.frame===observationFrame(reading) && reading.behavior.answers.length===ticket.behavior.inputs.length;
  const insert=db.prepare("INSERT OR IGNORE INTO port_disputes VALUES(?,?)");
  const prior=JSON.parse(sample.rows);
  for(const [i,row] of prior.entries()){
    if (!sameFrame || serial(row.answer)!==serial(reading.behavior.answers[i])) insert.run(ticket.pulse,serial(row.input));
  }
}
// Bind the disposable row cache to the authenticated receipt in the protected journal.
export function sampleBinding(digest,pulse,job,runtime,snapshot,rows) {
  return hash(["earned-rows/1",digest,pulse,job,runtime,snapshot,rows]);
}
export function acceptBehavior(db,ticket,reading,effect,retainOrigin=false) {
  const probe=ticket.behavior, observation=reading.behavior;
  validateReading(probe,observation);
  if (!probe && observation===undefined) return effect;
  if (effect.status!=="delivery_confirmed" || !effect.matchesCurrentBytes || observation.snapshot!==reading.snapshot ||
      observation.release!==reading.current.release || observation.contentHash!==reading.current.contentHash)
    return {...effect,status:"hold",reason:"the running service and the verified delivery do not identify the same snapshot"};
  if (observation.implementation!==probe.expected)
    return {...effect,status:"hold",reason:"the running implementation differs from the reviewed job",expected:probe.expected,actual:observation.implementation};
  if (!observation.fixed) return {...effect,status:"hold",reason:"the receiver cannot attest fixed behavior for this executable and input"};
  db.exec("CREATE TABLE IF NOT EXISTS port_samples(pulse TEXT PRIMARY KEY,job TEXT NOT NULL,implementation TEXT NOT NULL,snapshot TEXT NOT NULL,rows TEXT NOT NULL,units INTEGER NOT NULL,frame TEXT NOT NULL); CREATE TABLE IF NOT EXISTS port_disputes(pulse TEXT NOT NULL,input TEXT NOT NULL,PRIMARY KEY(pulse,input))");
  const rows=serial(probe.inputs.map((input,i)=>({input,answer:observation.answers[i]})));
  db.prepare("INSERT OR IGNORE INTO port_samples VALUES(?,?,?,?,?,?,?)").run(ticket.pulse,ticket.job,probe.expected,reading.snapshot,rows,1+chunks(rows),observationFrame(reading));
  if (retainOrigin) {
    db.exec("CREATE TABLE IF NOT EXISTS port_origins(pulse TEXT PRIMARY KEY,job TEXT NOT NULL,runtime TEXT NOT NULL,snapshot TEXT NOT NULL,binding TEXT NOT NULL,units INTEGER NOT NULL)");
    const binding=sampleBinding(hash(reading),ticket.pulse,ticket.job,probe.expected,reading.snapshot,rows);
    db.prepare("INSERT OR IGNORE INTO port_origins VALUES(?,?,?,?,?,?)")
      .run(ticket.pulse,ticket.job,probe.expected,reading.snapshot,binding,1+chunks(rows)+chunks(serial(probe.inputs)));
  }
  return {...effect,port:probe.port,runningImplementation:probe.expected,observed:observation.answers.filter(v=>v!==null).length,
    requested:probe.inputs.length};
}
export function comparePorts(db,account,request,jobInfo) {
  const d=request.body.data, p=account.terms.behaviorPort;
  need(p && d.before!==d.after,"name two distinct jobs on the approved behavior port");
  for(const job of [d.before,d.after]) {jobInfo(db,job);expectedRuntime(db,job);}
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='port_samples'").get();
  const rows=table?db.prepare(`SELECT s.*, o.disputed FROM port_samples s
    JOIN receiver_observations o ON o.pulse=s.pulse
    JOIN operations t ON t.id=s.pulse JOIN grants g ON g.key=t.actor
    WHERE g.active=1 AND s.job IN (?,?) ORDER BY s.pulse`).all(d.before,d.after):[];
  const views=new Map([[d.before,new Map()],[d.after,new Map()]]);
  const provenance=[],disputes=new Map([[d.before,new Set()],[d.after,new Set()]]);
  for (const sample of rows) {
    const blocked=disputes.get(sample.job);
    if (sample.disputed) {
      for(const r of db.prepare("SELECT input FROM port_disputes WHERE pulse=?").all(sample.pulse))blocked.add(r.input);
    }
    const map=views.get(sample.job);
    provenance.push({job:sample.job,pulse:sample.pulse,snapshot:sample.snapshot,implementation:sample.implementation});
    for(const {input,answer} of JSON.parse(sample.rows)) {
      if (answer===null)continue;
      const k=serial(input);
      const representation=serial(p.output==="exact-json/1"?answer.value:answer);
      if (map.has(k) && map.get(k)!==representation)blocked.add(k);
      map.set(k,representation);
    }
  }
  const before=views.get(d.before), after=views.get(d.after), changes=[];
  let compared=0,missing;
  const disputedInputs=[];
  for (const input of p.inputs) {
    const k=serial(input);
    if (disputes.get(d.before).has(k)||disputes.get(d.after).has(k)) {disputedInputs.push(input);continue;}
    if (!before.has(k)||!after.has(k)) {missing??={input,missingBefore:!before.has(k),missingAfter:!after.has(k)};continue;}
    compared++;
    if (before.get(k)!==after.get(k)) changes.push({input,before:JSON.parse(before.get(k)),after:JSON.parse(after.get(k))});
  }
  const result={status:changes.length?"observed_change":missing||disputedInputs.length?"port_unknown":"declared_inputs_agree",port:p.id,
    basis:p.basis,before:d.before,after:d.after,compared,total:p.inputs.length,changes,firstMissing:missing??null,disputedInputs,provenance,
    output:p.output??"boolean",scope:"observed immutable job editions, enrolled deterministic port and declared inputs"};
  return result;
}
