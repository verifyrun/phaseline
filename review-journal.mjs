// Persistent one-account journal for an enrolled, finite replacement-checker session.
// Only authenticated, in-scope attempts can spend the account's opening balance.
import {validSourcePorts} from "./version-source.mjs";
import {DatabaseSync} from "node:sqlite";
import {createHash,createPublicKey,verify} from "node:crypto";
import {closeSync,openSync} from "node:fs";
import {canonical} from "./carry.mjs";
import {validSize} from "./review-program.mjs";
import {exactValue} from "./exact-json.mjs";

export class Hold extends Error {}
export function need(condition,reason) { if (!condition) throw new Hold(reason); }
export const id = v => typeof v==="string" && /^[A-Za-z0-9_.:/-]{1,160}$/.test(v);
export const key = v => typeof v==="string" && /^[0-9a-f]{64}$/.test(v);
export const serial = value=>JSON.stringify(canonical(value));
export const hash = value=>createHash("sha256").update(serial(value)).digest("hex");
export function signedBytes(type,body) { return Buffer.from(serial(["phaseline.funded-review/1",type,body])); }
export function signedBy(type,envelope,expected) {
  if (!key(expected) || !envelope || envelope.key!==expected || typeof envelope.signature!=="string" ||
      !/^[0-9a-f]{128}$/.test(envelope.signature) || !envelope.body || typeof envelope.body!=="object") return false;
  const der=Buffer.from("302a300506032b6570032100"+expected,"hex");
  return verify(null,signedBytes(type,envelope.body),createPublicKey({key:der,format:"der",type:"spki"}),Buffer.from(envelope.signature,"hex"));
}
export function receiverTerms(value) {
  return exact(value,["store","history","repeat"]) && id(value.store)
    && ["stable_job","may_repeat"].includes(value.repeat)
    && ["complete_job_log","current_content_only"].includes(value.history);
}
export function exact(obj,fields,optional=[]) {
  return obj!==null && typeof obj==="object" && !Array.isArray(obj) &&
    fields.every(k=>Object.hasOwn(obj,k)) && Object.keys(obj).every(k=>fields.includes(k)||optional.includes(k));
}

function connect(path,create) {
  // SQLite's default constructor would silently create an empty account on a miss.
  // O_EXCL at creation and O_RDWR otherwise also keep a failed lookup side-effect free.
  if (create) {
    try { closeSync(openSync(path,"wx",0o600)); }
    catch (e) { if(e.code!=="EEXIST") throw e; }
  } else closeSync(openSync(path,"r+"));
  const db=new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=8000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
  return db;
}
export function transaction(db,work) {
  db.exec("BEGIN IMMEDIATE");
  try { const v=work(); db.exec("COMMIT"); return v; }
  catch(e) { db.exec("ROLLBACK"); throw e; }
}
export function account(db) {
  const row=db.prepare("SELECT * FROM account WHERE singleton=1").get();
  need(row,"Account has no admitted enrollment.");
  return {...row,terms:JSON.parse(row.terms)};
}
const APP_ID=1347573553;
export function openExisting(path) {
  const db=connect(path,false);
  if (db.prepare("PRAGMA application_id").get().application_id===APP_ID) return db;
  db.close();
  throw new Hold("This file is not an enrolled Phaseline review account.");
}
export function debit(db,operation,stage,units) {
  if (!Number.isSafeInteger(units) || units<1) throw Error("Invalid priced operation.");
  const changed=db.prepare("UPDATE account SET balance=balance-? WHERE singleton=1 AND balance>=?").run(units,units);
  if (changed.changes!==1) throw new Hold("insufficient balance for "+stage);
  db.prepare("INSERT INTO charges(operation,stage,units) VALUES(?,?,?)").run(operation,stage,units);
}
const schema = [
  "CREATE TABLE account(singleton INTEGER PRIMARY KEY CHECK(singleton=1), binding TEXT UNIQUE NOT NULL, root TEXT NOT NULL, terms TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0), revision TEXT NOT NULL, installed TEXT)",
  "CREATE TABLE grants(key TEXT PRIMARY KEY, role TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)))",
  "CREATE TABLE charges(seq INTEGER PRIMARY KEY, operation TEXT NOT NULL, stage TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0))",
  "CREATE TABLE operations(id TEXT PRIMARY KEY, actor TEXT NOT NULL, fingerprint TEXT NOT NULL, epoch INTEGER NOT NULL, answer TEXT)",
  "CREATE TABLE pulses(id TEXT PRIMARY KEY, actor TEXT NOT NULL, position INTEGER NOT NULL, claim INTEGER NOT NULL)",
  "CREATE TABLE observations(cell INTEGER PRIMARY KEY, pulse TEXT UNIQUE NOT NULL REFERENCES pulses(id), answer TEXT NOT NULL, signed_receipt TEXT NOT NULL)",
  "CREATE TABLE disputes(cell INTEGER PRIMARY KEY, contrary_receipt TEXT NOT NULL)",
  "CREATE TABLE candidates(id TEXT PRIMARY KEY, actor TEXT NOT NULL, base TEXT NOT NULL, image TEXT NOT NULL, digest TEXT NOT NULL, stage TEXT NOT NULL)",
  "CREATE TABLE jobs(id TEXT PRIMARY KEY, actor TEXT NOT NULL, revision TEXT NOT NULL, position INTEGER NOT NULL, claim INTEGER NOT NULL, content TEXT NOT NULL, fingerprint TEXT NOT NULL)",
  "CREATE TABLE deliveries(job TEXT PRIMARY KEY REFERENCES jobs(id), revision TEXT NOT NULL, verdict TEXT NOT NULL, work INTEGER NOT NULL)",
  "CREATE TABLE publications(job TEXT PRIMARY KEY REFERENCES deliveries(job), content TEXT NOT NULL)"
];
function decoderContract(port) {
  const c=port.decoder;
  if(!exact(c,["request","slots","alphabet","read","offer"],["target","targets"]) || Object.hasOwn(c,"target")===Object.hasOwn(c,"targets") || !id(c.request) ||
      port.output!=="exact-json/1" || !Array.isArray(c.slots) || c.slots.length<2 || c.slots.length>64 ||
      !Array.isArray(c.alphabet) || c.alphabet.length!==c.slots.length || !c.alphabet.every(v=>exactValue(v)))return false;
  const inputs=new Set(port.inputs.map(serial)),slots=c.slots.map(serial),labels=c.alphabet.map(serial);
  return slots.every(v=>inputs.has(v)) && new Set(slots).size===slots.length &&
    new Set(labels).size===labels.length &&
    (Object.hasOwn(c,"target") ? exactValue(c.target) && labels.includes(serial(c.target)) :
      Array.isArray(c.targets) && c.targets.length>=1 && c.targets.length<=slots.length &&
      c.targets.every(v=>exactValue(v) && labels.includes(serial(v))) && new Set(c.targets.map(serial)).size===c.targets.length) &&
    [c.read,c.offer].every(menu=>Array.isArray(menu) && menu.length<=slots.length && menu.every(i=>Number.isSafeInteger(i)&&i>=0&&i<slots.length) && new Set(menu).size===menu.length);
}
function validLate(port) {
  const x=port.late;
  if(!exact(x,["relation","early","probes"]) || !key(x.relation) || !Array.isArray(x.probes) || x.probes.length>32)return false;
  const allowed=new Set(port.inputs.map(serial));
  return allowed.has(serial(x.early)) &&
    x.probes.every(p=>exact(p,["id","input"]) && id(p.id) && allowed.has(serial(p.input))) &&
    new Set(x.probes.map(p=>p.id)).size===x.probes.length;
}

function validateTerms(root,packet) {
  const t=packet?.body;
  need(signedBy("enrollment",packet,root),"untrusted enrollment");
  need(exact(t,["account","subject","before","edition","destination","sourceKey","receiverKey","operators","size","budget","tariff"],["receiverContract","withdrawal","behaviorPort"]),
    "invalid enrollment fields");
  need([t.account,t.subject,t.before,t.edition,t.destination].every(id) && t.before!==t.edition &&
    t.tariff==="review-operations/1" && Number.isSafeInteger(t.budget) && t.budget>=1 && t.budget<=1e9,"invalid contract or opening balance");
  if (Object.hasOwn(t,"behaviorPort")) {
    const p=t.behaviorPort;
    need(receiverTerms(t.receiverContract) && exact(p,["id","basis","inputs","price"],["output","memory","late","question","decoder"]) && id(p.id) &&
      (!Object.hasOwn(p,"output") || p.output==="exact-json/1") &&
      typeof p.basis==="string" && p.basis.length>0 && p.basis.length<=512 &&
      Number.isSafeInteger(p.price) && p.price>=1 && p.price<=1000000 &&
      Array.isArray(p.inputs) && p.inputs.length>=1 && p.inputs.length<=4096 &&
      p.inputs.every(input=>Array.isArray(input) && input.length>=1 && input.length<=16 &&
        input.every(v=>Number.isSafeInteger(v)||typeof v==="boolean"||(typeof v==="string"&&v.length<=128))) &&
      new Set(p.inputs.map(serial)).size===p.inputs.length && Buffer.byteLength(serial(p))<=65536,
      "supply a finite receiver port, priced raw inputs and the origin of this domain");
    if (Object.hasOwn(p,"decoder"))need(decoderContract(p),"invalid funded revised-decoder contract");
    if (Object.hasOwn(p,"question"))need(exact(p.question,["brief"],["topics","beforeUse","recordSources"]) && key(p.question.brief) &&
      (p.question.topics===undefined || (Array.isArray(p.question.topics) && p.question.topics.length>=1 && p.question.topics.length<=32 &&
        p.question.topics.every(id) && new Set(p.question.topics).size===p.question.topics.length)),"bind the product question to the digest of the original brief");
    if (p.question && Object.hasOwn(p.question,"recordSources"))
      need(p.question.beforeUse==="checked/1" && validSourcePorts(p.question.recordSources),
        "declare the subscribing project, versioned source readers, retained fields, costs and guarded first use");
    if (p.question && Object.hasOwn(p.question,"beforeUse"))need(p.question.beforeUse==="checked/1" &&
      t.receiverContract.repeat==="stable_job" && t.receiverContract.history==="complete_job_log",
      "guarded first use requires stable job identity and a complete receiving log");
    if (Object.hasOwn(p,"late"))need(validLate(p),"invalid one-later relation or source route");
    if (Object.hasOwn(p,"memory")) {
      const m=p.memory;
      need(exact(m,["capacity","alphabet"]) && Number.isSafeInteger(m.capacity) && m.capacity>=0 &&
        m.capacity<=Math.min(p.inputs.length,128) && Array.isArray(m.alphabet) && m.alphabet.length>=1 &&
        m.alphabet.length<=256 && m.alphabet.every(v=>p.output==="exact-json/1"?exactValue(v):typeof v==="boolean") &&
        new Set(m.alphabet.map(serial)).size===m.alphabet.length,"invalid earned-memory capacity or public value alphabet");
    }
  }
  if (Object.hasOwn(t,"withdrawal"))
    need(t.withdrawal==="receiver_ack/1" && receiverTerms(t.receiverContract),"withdrawal requires a separately enrolled receiver");
  if (Object.hasOwn(t,"receiverContract")) {
    const c=t.receiverContract;
    need(receiverTerms(c),
      "invalid external receiver contract");
  }
  try { validSize(t.size); } catch(e) { throw new Hold(e.message); }
  need(Array.isArray(t.operators) && t.operators.length>=1 && t.operators.length<=8,"invalid operators");
  const keys=[root,t.sourceKey,t.receiverKey,...t.operators,...(t.behaviorPort?.question?.recordSources??[]).map(p=>p.key)];
  need(keys.every(key) && new Set(keys).size===keys.length,"assign a distinct enrolled key to each role");
  return t;
}
export function enroll(path,root,packet) {
  const terms=validateTerms(root,packet),binding=hash([root,terms]);
  const db=connect(path,true);
  try {
    const answer=transaction(db,()=>{
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account'").get()) {
        need(db.prepare("PRAGMA application_id").get().application_id===APP_ID,"different database application");
        const a=account(db);
        need(a.binding===binding && a.root===root,"account has a different enrollment");
        return {status:"already_enrolled",binding};
      }
      need(db.prepare("PRAGMA application_id").get().application_id===0 && !db.prepare("SELECT name FROM sqlite_master LIMIT 1").get(),
        "refuse to enroll into an existing database");
      db.exec("PRAGMA application_id="+APP_ID);
      for (const statement of schema) db.exec(statement);
      db.prepare("INSERT INTO account VALUES(1,?,?,?,?,?,NULL)").run(binding,root,serial(terms),terms.budget,terms.before);
      const create=db.prepare("INSERT INTO grants VALUES(?,?,1)");
      create.run(root,"predecessor");
      create.run(terms.receiverKey,"receiver");
      create.run(terms.sourceKey,"source");
      for(const source of terms.behaviorPort?.question?.recordSources??[])create.run(source.key,"version_source");
      for (const operator of terms.operators) create.run(operator,"operator");
      debit(db,"enrollment","verify and retain the opening contract",1);
      return {status:"enrolled",binding,balance:account(db).balance};
    });
    db.exec("PRAGMA journal_mode=WAL");
    return answer;
  } finally { db.close(); }
}

export function grant(db,actor) {return db.prepare("SELECT role FROM grants WHERE key=? AND active=1").get(actor)?.role;}
export function observations(db,size) {
  need(!db.prepare("SELECT cell FROM disputes LIMIT 1").get(),"authenticated source readings conflict within this edition");
  const rows=db.prepare("SELECT cell,answer FROM observations ORDER BY cell").all();
  need(rows.length===2*size && rows.every((r,i)=>r.cell===i),"the incumbent has an unobserved input");
  return rows.map(r=>JSON.parse(r.answer));
}
