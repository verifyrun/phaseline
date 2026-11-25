// Minimum fixed records for a supplied finite relation. An early observer sees
// one early symbol. On return, the question and record select at most one probe.
import {canonical} from "./carry.mjs";
import {exactValue} from "./exact-json.mjs";

const serial=value=>JSON.stringify(canonical(value));
const names=xs=>Array.isArray(xs) && xs.every(s=>typeof s==="string" && s.length>0 && s.length<=128) && new Set(xs).size===xs.length;
const requireThat=(ok,message)=>{if(!ok)throw new Error(message);};
class Exhausted extends Error {}
const constant=""; // Serialized JSON never equals the empty string.
const bit=i=>1n<<BigInt(i);

function prepare(table,spend) {
  requireThat(table?.format==="one-later/1" && names(table.probes) && table.probes.length<=32 &&
    Array.isArray(table.questions) && table.questions.length>=1 && table.questions.length<=64 &&
    names(table.questions.map(q=>q?.id)) && Array.isArray(table.rows) && table.rows.length>=1 && table.rows.length<=100000,
    "Supply a finite one-later/1 table with a nonempty question menu and rows.");
  const choices=table.questions.map(q=>{
    requireThat(names(q.permitted) && q.permitted.every(x=>table.probes.includes(x)),"Unknown or repeated permitted observation.");
    return [-1,...q.permitted.map(x=>table.probes.indexOf(x))];
  });
  const atoms=[],index=new Map();
  for (const [i,row] of table.rows.entries()) {
    spend();
    requireThat(row && exactValue(row.early) && Array.isArray(row.replies) && row.replies.length===table.probes.length &&
      Array.isArray(row.answers) && row.answers.length===choices.length && row.replies.every(v=>exactValue(v)) && row.answers.every(v=>exactValue(v)),
      "Every declared row needs one early value, all offered replies and all owed answers.");
    spend(Math.max(1,Math.ceil(Buffer.byteLength(serial(row))/256)));
    const token=serial(row.early);
    if (!index.has(token)) {
      if(atoms.length>=256)throw new Exhausted("more than 256 distinct early observations");
      index.set(token,atoms.length);
      atoms.push({early:row.early,first:i,options:choices.map(q=>q.map(()=>({map:new Map(),conflict:null})))});
    }
    const atom=atoms[index.get(token)],replies=row.replies.map(serial);
    for(const [q,options] of choices.entries()) {
      const wanted=serial(row.answers[q]);
      for(const [j,probe] of options.entries()) {
        spend();
        const option=atom.options[q][j];
        if (option.conflict)continue;
        const reply=probe===-1?constant:replies[probe], prior=option.map.get(reply);
        if(prior && prior.answer!==wanted)option.conflict=[prior.row,i];
        else if(!prior)option.map.set(reply,{answer:wanted,row:i});
      }
    }
  }
  return {atoms,choices};
}
function masks(a,b,spend) {
  return a.options.map((probes,q)=>{
    let mask=0n;
    for(const [i,x] of probes.entries()) {
      spend();
      const y=b.options[q][i];
      if(x.conflict || y.conflict)continue;
      let works=true;
      if(a!==b) {
        const [small,large]=x.map.size<y.map.size?[x.map,y.map]:[y.map,x.map];
        for(const [reply,record] of small) {
          spend();
          const z=large.get(reply);
          if(z && z.answer!==record.answer) {works=false;break;}
        }
      }
      if(works)mask|=bit(i);
    }
    return mask;
  });
}
function canJoin(bin,c,pairs,spend) {
  const next=[...bin.allowed];
  for(const a of bin.members) {
    for(let q=0;q<next.length;q++) {
      spend();
      next[q]&=pairs[a][c][q];
      if(next[q]===0n)return null;
    }
  }
  return {allowed:next,members:[...bin.members,c]};
}
// A feasible bin requires a *common* probe per question for all pairs in it.
// Pairwise compatibility alone does not ensure that the whole bin is decodable.
function minimize(pairs,spend) {
  const count=pairs.length,order=Array.from({length:count},(_,i)=>i);
  const edges=pairs.map(row=>row.map(x=>x.includes(0n)));
  const degree=edges.map(row=>row.filter(Boolean).length);
  order.sort((a,b)=>degree[b]-degree[a] || a-b);
  const alone=c=>({members:[c],allowed:pairs[c][c]});
  const clique=[];
  for(const c of order) {spend();if(clique.every(x=>edges[x][c]))clique.push(c);}
  let best=[];
  for(const c of order) {
    let join;
    const slot=best.findIndex(bin=>Boolean(join=canJoin(bin,c,pairs,spend)));
    if(slot<0)best.push(alone(c));else best[slot]=join;
  }
  const lower=Math.max(1,clique.length);
  const walk=(i,bins)=>{
    spend();
    if(best.length===lower || bins.length>=best.length)return;
    if(i===count) {best=[...bins];return;}
    const c=order[i];
    for(const [j,bin] of bins.entries()) {
      const joined=canJoin(bin,c,pairs,spend);
      if(joined) {bins[j]=joined;walk(i+1,bins);bins[j]=bin;}
      if(best.length===lower)return;
    }
    if(bins.length+1<best.length) {bins.push(alone(c));walk(i+1,bins);bins.pop();}
  };
  if(best.length>lower)walk(0,[]);
  return best;
}
export function oneLater(table,limits={}) {
  const allowance=limits?.workLimit??5000000;
  requireThat(Number.isSafeInteger(allowance) && allowance>=1 && allowance<=100000000,"Invalid one-later work limit.");
  let work=0;
  const spend=(units=1)=>{if(units>allowance-work)throw new Exhausted("construction work allowance exhausted");work+=units;};
  try {
    const {atoms,choices}=prepare(table,spend);
    const pairs=atoms.map(()=>Array(atoms.length));
    for(let i=0;i<atoms.length;i++) {
      pairs[i][i]=masks(atoms[i],atoms[i],spend);
      const q=pairs[i][i].indexOf(0n);
      if(q>=0) {
        const cases=choices[q].map((probe,j)=>({probe:table.probes[probe]??null,rows:atoms[i].options[q][j].conflict}));
        return {status:"unachievable",early:atoms[i].early,question:table.questions[q].id,cases,work,
          reason:"the same early observation leaves a conflicting reply on every permitted single read"};
      }
      for(let j=0;j<i;j++)pairs[i][j]=pairs[j][i]=masks(atoms[i],atoms[j],spend);
    }
    const bins=minimize(pairs,spend);
    const records=bins.map(bin=>{
      const decoders=choices.map((options,q)=>{
        const chosen=options.findIndex((_,j)=>(bin.allowed[q]&bit(j))!==0n), probe=options[chosen];
        const entries=new Map();
        for(const i of bin.members)for(const [reply,rec] of atoms[i].options[q][chosen].map) {spend();entries.set(reply,rec.answer);}
        return {question:table.questions[q].id,probe:table.probes[probe]??null,
          answers:[...entries].map(([reply,answer])=>({...(probe>=0?{reply:JSON.parse(reply)}:{}),value:JSON.parse(answer)}))};
      });
      return {early:bin.members.map(i=>atoms[i].early),decoders};
    });
    return {status:"minimum",distinctRecords:records.length,payloadBits:Math.ceil(Math.log2(records.length)),
      observedEarlySymbols:atoms.length,declaredRows:table.rows.length,work,records,scope:"supplied finite relation, deterministic answers, at most one declared later observation"};
  } catch(e) {
    if(e instanceof Exhausted)return {status:"hold",reason:e.message,work};
    throw e;
  }
}
export function earlyRecord(plan,observation) {
  requireThat(plan.status==="minimum" && exactValue(observation),"A completed plan and actual early observation are required.");
  const k=serial(observation),code=plan.records.findIndex(r=>r.early.some(x=>serial(x)===k));
  return code===-1?{status:"hold",reason:"unrepresented early observation"}:{status:"encoded",code};
}
export function returnQuestion(plan,code,question,read=null) {
  requireThat(plan.status==="minimum" && Number.isSafeInteger(code) && code>=0,"A completed plan and a valid record are required.");
  const which=plan.records[code]?.decoders.find(x=>x.question===question);
  if(!which)return {status:"hold",reason:"record or question absent from the plan"};
  if(which.probe===null)return read===null?{status:"determined",value:which.answers[0].value}:{status:"hold",reason:"this decoder requires no supplied read"};
  if(read===null)return {status:"needs_observation",probe:which.probe};
  if(read.probe!==which.probe || !exactValue(read.value))return {status:"hold",reason:"wrong later observation"};
  const entry=which.answers.find(x=>serial(x.reply)===serial(read.value));
  return entry?{status:"determined",value:entry.value}:{status:"hold",reason:"unrepresented later reply"};
}
