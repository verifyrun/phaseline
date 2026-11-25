// Test a proposed projection at the original input port, before values are normalized.
import {digest} from "./carry.mjs";
import {observationBytes} from "./conformance.mjs";

const MAX_ROWS = 32768;
const name = x => typeof x === "string" && x.length > 0 && x.length <= 256;
const integer = Number.isSafeInteger;
const allowedValue = v => integer(v) || typeof v === "boolean" || name(v);
function shape(o, keys, label) {
  if (!o || typeof o !== "object" || Array.isArray(o) ||
      !Object.keys(o).every(k => keys.includes(k))) throw Error("Invalid "+label+" fields.");
}
function axis(spec) {
  shape(spec,["name","values","min","max"],"raw axis");
  if (!name(spec.name)) throw Error("Invalid raw axis name.");
  if (Array.isArray(spec.values)) {
    const choices = new Set(spec.values);
    if ("min" in spec || "max" in spec || choices.size !== spec.values.length ||
        choices.size < 1 || choices.size > 4096 || !spec.values.every(allowedValue))
      throw Error("Invalid raw axis values.");
    return {name:spec.name, count:choices.size, at:i=>spec.values[i], admits:v=>choices.has(v)};
  }
  if (!integer(spec.min) || !integer(spec.max) || spec.min > spec.max ||
      spec.max-spec.min > 1000000000) throw Error("Invalid raw integer range.");
  return {name:spec.name, count:spec.max-spec.min+1, at:i=>spec.min+i,
    admits:v=>integer(v) && v>=spec.min && v<=spec.max};
}
const product = axes => axes.reduce((n,a)=>n*BigInt(a.count),1n);

// A field can be kept exactly, omitted, or rounded into fixed-width integer
// buckets. Only clipped end buckets can have a single member for width > 1.
function projection(axis, spec, selected) {
  const empty={count:0}, all=axis;
  if (selected === undefined) return {key:()=>null, alone:axis.count===1?all:empty, shared:axis.count===1?empty:all};
  if (typeof selected === "string" || selected.width===1) return {key:v=>v,alone:all,shared:empty};
  const width=BigInt(selected.width), origin=BigInt(selected.origin);
  const key=v=>{
    const delta=BigInt(v)-origin;
    return String(delta>=0n?delta/width:-((-delta+width-1n)/width));
  };
  const first=spec.min,last=spec.max;
  const leftIsSingle=first===last || key(first)!==key(first+1);
  const rightIsSingle=first!==last && key(last)!==key(last-1);
  const ends=[...(leftIsSingle?[first]:[]),...(rightIsSingle?[last]:[])];
  const start=first+(leftIsSingle?1:0);
  return {key,alone:{count:ends.length,at:i=>ends[i]},
    shared:{count:axis.count-ends.length,at:i=>start+i}};
}

export async function rawInterface(terms) {
  shape(terms,["format","subject","edition","source","key","demand","basis","axes","keep","costs","budget"],"raw contract");
  if (terms.format !== "raw-inputs/1" || ![terms.subject,terms.edition,terms.source,terms.demand].every(name) ||
      !(terms.basis === null || name(terms.basis)) || !/^[0-9a-f]{64}$/.test(terms.key) ||
      !Array.isArray(terms.axes) || !terms.axes.length || terms.axes.length>16 ||
      !Array.isArray(terms.keep)) throw Error("Invalid raw input contract.");
  shape(terms.costs,["attest","read"],"raw tariff");
  if (![terms.costs.attest,terms.costs.read,terms.budget].every(n=>integer(n)&&n>=0&&n<=1e9) ||
      terms.costs.read===0) throw Error("Invalid acquisition tariff.");
  const axes=terms.axes.map(axis), names=axes.map(a=>a.name);
  const selections=new Map();
  for (const choice of terms.keep) {
    const field=typeof choice==="string"?choice:choice?.axis;
    const i=names.indexOf(field);
    if (i<0 || selections.has(field)) throw Error("Duplicate or unknown retained dimension.");
    if (typeof choice!=="string") {
      shape(choice,["axis","width","origin"],"integer projection");
      if (!integer(choice.width)||choice.width<1||!integer(choice.origin)||!("min" in terms.axes[i]))
        throw Error("Round an integer range with a positive width and an explicit integer origin.");
    }
    selections.set(field,choice);
  }
  if (new Set(names).size!==names.length) throw Error("Duplicate raw dimension.");
  const parts=axes.map((a,i)=>projection(a,terms.axes[i],selections.get(a.name)));
  const free=axes.map((_,i)=>i).sort((i,j)=>Number(parts[j].shared.count>0)-Number(parts[i].shared.count>0));
  const regions=[];
  // Each point needing a reading belongs to the first nonsingleton coordinate
  // in this order. The regions are disjoint and need no expanded input table.
  for (let k=0;k<free.length;k++) {
    const dimensions=free.map((i,j)=>j<k?parts[i].alone:j===k?parts[i].shared:axes[i]);
    const size=product(dimensions);
    if (size) regions.push({dimensions,size});
  }
  const binding=await digest(["phaseline.raw-inputs/1",terms]);
  const total=product(axes);
  const required=regions.reduce((n,r)=>n+r.size,0n);
  return {terms,axes,names,binding,parts,free,regions,total,required};

}

function inputAt({axes,regions,free}, ordinal) {
  let index=ordinal;
  for (const region of regions) {
    if (index>=region.size) {index-=region.size;continue;}
    const values=Array(axes.length);
    for (const [j,a] of region.dimensions.entries()) {
      const size=BigInt(a.count);
      values[free[j]]=a.at(Number(index%size)); index/=size;
    }
    return values;
  }
  throw Error("Raw input ordinal outside the nontrivial projection cells.");
}

function otherInCell(contract,input) {
  for (const [i,p] of contract.parts.entries()) {
    if (!p.shared.count) continue;
    const spec=contract.terms.axes[i], value=input[i];
    const alternatives=spec.values ? spec.values.slice(0,2) : [value-1,value+1];
    for (const candidate of alternatives) {
      if (candidate===value || !contract.axes[i].admits(candidate) || p.key(value)!==p.key(candidate)) continue;
      const sibling=input.slice(); sibling[i]=candidate;
      return sibling;
    }
  }
  throw Error("Expected a second point in the shared projection cell.");
}

export function rawSchedule(contract,limit=256,offset=0n) {
  const {terms,binding,total,required}=contract;
  if (!integer(limit)||limit<1||limit>MAX_ROWS||typeof offset!=="bigint"||offset<0n) throw Error("Invalid schedule page.");
  const afforded=BigInt(Math.max(0,Math.floor((terms.budget-terms.costs.attest)/terms.costs.read)));
  const end=required<afforded?required:afforded;
  const inputs=[];
  // Vary a discarded input while all retained inputs still describe the same request.
  for (let p=offset;p<end&&inputs.length<limit;p++) {
    inputs.push(inputAt(contract,p));
  }
  const next=offset+BigInt(inputs.length);
  return {status:terms.budget<terms.costs.attest?"hold":"planned",binding,rawDomainSize:String(total),
    readsForWorstCase:String(required),completeAcquisitionCost:String(BigInt(terms.costs.attest)+required*BigInt(terms.costs.read)),
    affordableReadLimit:String(end),inputs,nextOffset:next<end?String(next):null};
}

export function rawObservationBytes(body) {
  return observationBytes(["phaseline.raw-input-readings/1",body]);
}
const bytes=h=>Uint8Array.from(h.match(/../g),s=>parseInt(s,16));

export async function assessRaw(contract,packet) {
  const {terms,binding,axes,names,parts,total,required}=contract;
  shape(packet,["body","signature"],"raw receiver report");
  const body=packet.body;
  shape(body,["binding","fixedEdition","deterministic","rawPortComplete","rows"],"signed raw readings");
  const hold=(reason,extra={})=>({status:"hold",binding,reason,...extra});
  if (body.binding!==binding) return hold("readings identify a different source, contract, edition or tariff");
  if (!Array.isArray(body.rows)||body.rows.length>MAX_ROWS ||
      ![body.fixedEdition,body.deterministic,body.rawPortComplete].every(v=>typeof v==="boolean")) throw Error("Malformed raw readings.");
  if (typeof packet.signature!=="string" || !/^[0-9a-f]{128}$/.test(packet.signature)) return hold("missing receiver signature");
  const key=await crypto.subtle.importKey("raw",bytes(terms.key),"Ed25519",false,["verify"]);
  if (!await crypto.subtle.verify("Ed25519",key,bytes(packet.signature),rawObservationBytes(body))) return hold("receiver signature failed");
  const spent=terms.costs.attest+terms.costs.read*body.rows.length;
  if (spent>terms.budget) return hold("the received observations exceed the granted acquisition budget",{spent,budget:terms.budget});
  if (!body.fixedEdition || !body.deterministic) return hold("the source cannot attest a fixed deterministic answer",{spent});
  const observed=new Map(), cells=new Map(), supports=axes.map(()=>new Map()), essential=new Map();
  let collision;
  let necessaryReadings=0n;
  for (const row of body.rows) {
    shape(row,["input","answer"],"raw reading");
    if (!Array.isArray(row.input)||row.input.length!==axes.length||
        !row.input.every((v,i)=>axes[i].admits(v)) || typeof row.answer!=="boolean")
      throw Error("A raw reading falls outside the declared input or answer type.");
    const id=JSON.stringify(row.input);
    const prior=observed.get(id);
    if (prior) {
      if (prior.answer!==row.answer) return hold("the same physical input produced conflicting signed answers",{spent,input:row.input});
      continue;
    }
    observed.set(id,row);
    if (parts.some((p,i)=>p.shared.count>0 && (p.alone.count===0 ||
        !(Array.from({length:p.alone.count},(_,j)=>p.alone.at(j)).includes(row.input[i]))))) necessaryReadings++;
    const cell=JSON.stringify(parts.map((p,i)=>p.key(row.input[i])));
    const first=cells.get(cell);
    if (!first) cells.set(cell,row);
    else if (!collision && first.answer!==row.answer) collision={first,second:row};
    for (let i=0;i<axes.length;i++) {
      if (axes[i].count===1 || essential.has(i)) continue;
      const others=JSON.stringify(row.input.filter((_,j)=>i!==j));
      const earlier=supports[i].get(others);
      if (!earlier) supports[i].set(others,row);
      else if (earlier.answer!==row.answer) {
        essential.set(i,{axis:names[i],first:earlier,second:row});
        supports[i].clear();
      }
    }
  }
  const complete=BigInt(observed.size)===total;
  const trustedDomain=body.rawPortComplete&&terms.basis!==null;
  const detail={binding,spent,distinctReadings:observed.size,domainSize:String(total),
    missingInputs:String(total-BigInt(observed.size)),missingRequiredReadings:String(required-necessaryReadings),necessaryAxes:[...essential.values()].sort((a,b)=>names.indexOf(a.axis)-names.indexOf(b.axis))};
  if (complete&&trustedDomain) detail.leastSufficientAxes=names.filter((_,i)=>essential.has(i));
  if (collision) return {status:"inconsistent",...detail,witness:collision};
  if (!trustedDomain) return hold("raw interface coverage lacks an attested domain basis",detail);
  if (necessaryReadings!==required) {
    // Two total completions fit every funded observation. Fill each cell with
    // its observed answer (false if unseen), then flip just the missing point.
    let position=0n, missing;
    do {missing=inputAt(contract,position++);} while (observed.has(JSON.stringify(missing)));
    const cell=JSON.stringify(parts.map((p,i)=>p.key(missing[i])));
    const original=cells.get(cell)?.answer??false;
    return hold("some inputs in a shared projection cell have never been read",{...detail,unresolved:{
      missing,sibling:otherInCell(contract,missing),cellAnswerInConstantCompletion:original,
      missingAnswerInAlternative:!original,construction:"both completions agree on every measured input"}});
  }
  return {status:"conditionally_sufficient",...detail,retained:terms.keep,
    scope:"declared finite Cartesian inputs, fixed Boolean demand, deterministic source and attested raw port"};
}
