import {readEdition,evaluate,partitions,worlds,validObservation} from "./contract-language.mjs";
import {DecisionDiagram,compileAnswers} from "./decision-diagram.mjs";
export {readEdition};

export function enumeratedDifference(id,before,after,axes,budget) {
  let witness;
  worlds(axes,budget,input=>{
    if(evaluate(before,id,input)===evaluate(after,id,input)) return;
    witness={...input};
    return false;
  });
  return witness;
}

const DECIDE_ENUMERATION=256;

function affordableEnumeration(axes,budget,limit=65536) {
  let count=1;
  for(const [,values] of axes) {
    count*=values.length;
    if(count>limit) return false;
  }
  return budget.used+count<=1000000;
}

function buildDiagram(axes,budget) {
  budget.symbolic ??= {nodes:0,edges:0,calls:0};
  return new DecisionDiagram(axes.map(([,values])=>values.length),budget.symbolic);
}

// Inputs that a rule mentions together sit next to each other in the diagram. The
// alphabetical axis order still decides which distinguishing case is reported.
function appearanceOrder(id,editions,axes) {
  const position=new Map(axes.map(([name],i)=>[name,i])), order=[], placed=new Set();
  for(const edition of editions) {
    const expanded=new Set(), pending=[];
    if(edition.rules.has(id)) { expanded.add(id); pending.push(edition.rules.get(id)); }
    while(pending.length) {
      const n=pending.pop();
      if(n.op==="literal") continue;
      if(n.op==="and" || n.op==="or") { pending.push(n.right,n.left); continue; }
      if(n.op==="not") { pending.push(n.left); continue; }
      if(n.op==="name" && edition.rules.has(n.id)) {
        if(!expanded.has(n.id)) { expanded.add(n.id); pending.push(edition.rules.get(n.id)); }
        continue;
      }
      if(position.has(n.id) && !placed.has(n.id)) { placed.add(n.id); order.push(position.get(n.id)); }
    }
  }
  for(let i=0;i<axes.length;i++) if(!placed.has(axes[i][0])) order.push(i);
  return order;
}

export function diagramDifference(id,before,after,axes,budget) {
  budget.symbolic ??= {nodes:0,edges:0,calls:0};
  const order=appearanceOrder(id,[after,before],axes), level=Array(axes.length);
  order.forEach((axis,place)=>{level[axis]=place;});
  const diagram=new DecisionDiagram(order.map(axis=>axes[axis][1].length),budget.symbolic);
  const old=compileAnswers(diagram,before,axes,i=>level[i]);
  const next=compileAnswers(diagram,after,axes,i=>level[i]);
  let remaining=diagram.xor(old(id),next(id));
  if (!remaining) return undefined;
  // The first case in axis order: the least value of each input in turn that still leaves a difference.
  const witness=Object.create(null);
  for(const [i,[name,values]] of axes.entries()) {
    let chosen=-1;
    for(let value=0;value<values.length && chosen<0;value++) {
      const rest=diagram.restrict(remaining,level[i],value);
      if(rest) { chosen=value; remaining=rest; }
    }
    if(chosen<0) throw Error("Symbolic witness could not be completed.");
    witness[name]=values[chosen];
  }
  if(evaluate(before,id,witness)===evaluate(after,id,witness)) throw Error("Symbolic witness failed evaluator replay.");
  return {...witness};
}

function adaptiveDifference(id,before,after,axes,budget) {
  return affordableEnumeration(axes,budget)
    ? enumeratedDifference(id,before,after,axes,budget)
    : diagramDifference(id,before,after,axes,budget);
}

export function compareContracts(a,b,findDifference=adaptiveDifference) {
  const before=readEdition(a), after=readEdition(b);
  const ids=[...new Set([...before.rules.keys(),...after.rules.keys()])];
  const changes=[], bindings=[], budget={used:0};
  for(const [slot,name] of before.fields) {
    if(after.fields.has(slot) && after.fields.get(slot)!==name)
      throw Error("The same record changed fact name from "+name+" to "+after.fields.get(slot)+". Supply an explicit migration.");
  }
  const facts=new Set([...before.used,...before.bindings.keys()]);
  for(const fact of facts) {
    if((after.used.has(fact) || after.bindings.has(fact)) && before.type(fact)!==after.type(fact))
      throw Error("Incompatible fact types for "+fact+". Supply an explicit migration.");
    if((after.used.has(fact) || after.bindings.has(fact)) && before.type(fact)) {
      const [low,high]=before.range(fact), revised=after.range(fact);
      if(low!==revised[0] || high!==revised[1])
        throw Error("The admissible range changed for "+fact+". Supply an explicit domain migration.");
    }
  }
  for(const id of new Set([...before.bindings.keys(),...after.bindings.keys()])) {
    const left=before.bindings.get(id)??null, right=after.bindings.get(id)??null;
    if(left?.source!==right?.source || left?.owner!==right?.owner || left?.unit!==right?.unit ||
       left?.latest!==right?.latest || left?.standing!==right?.standing || left?.atEvent!==right?.atEvent || left?.within!==right?.within)
      bindings.push({id,before:left,after:right});
  }
  for(const id of ids) {
    const was=before.rules.has(id), now=after.rules.has(id);
    const kind=!was?"added":!now?"withdrawn":"changed";
    const witness=findDifference(id,before,after,partitions(id,[before,after]),budget);
    if(witness!==undefined) changes.push({id,kind,witness,
      before:was?evaluate(before,id,witness):"absent",after:now?evaluate(after,id,witness):"absent"});
    else if(was!==now) changes.push({id,kind,witness:null,before:was?false:"absent",after:now?false:"absent"});
  }
  const counted=(findDifference===enumeratedDifference || findDifference===adaptiveDifference) && !budget.symbolic;
  return {before,after,result:{ids,changes,combinations:counted?budget.used:null},bindings};
}

function visibleAtReview(record, packet, standing=false, atEvent=false) {
  if (!record || record.subject !== packet.subject || !Number.isSafeInteger(record.recorded) ||
      record.recorded > packet.asOf) return false;
  // "standing at event" asks what was in force when the request happened, using every record
  // written by the review time. Plain "standing" asks what is in force at the review time.
  if (standing) return Number.isSafeInteger(record.at) && record.at <= (atEvent ? packet.at : packet.asOf);
  return record.at === packet.at && record.recorded >= packet.at;
}

export function observationTimes(row, binding) {
  return binding.standing ? {at:row.at, recorded:row.recorded, value:row.value} : {recorded:row.recorded, value:row.value};
}

// Keep contradictory observations deterministic even when the packet is reordered.
function conflictEvidence(rows, binding) {
  function newer(left, right) {
    if (!left || right.recorded > left.recorded) return right;
    if (right.recorded === left.recorded && right.value > left.value) return right;
    return left;
  }
  const last = rows.reduce(newer, null);
  let other = null;
  for (const row of rows) if (row.value !== last.value) other = newer(other, row);
  return [other, last].map(row => observationTimes(row,binding));
}

const RECORD_FIELDS=["subject","at","recorded","source","by","value"];
const wholeTime="a whole number, such as seconds or minutes since a fixed start";
// Refuse a malformed case or record by name. Skipping it would turn a typo into a missing record.
function checkCase(packet) {
  if(!packet || typeof packet!=="object" || Array.isArray(packet))
    throw Error("A case is a JSON object with subject, at, asOf and records.");
  if(typeof packet.subject!=="string" || !packet.subject) throw Error("The case's subject must be non-empty text.");
  for(const key of ["at","asOf"]) if(!Number.isSafeInteger(packet[key]))
    throw Error(`The case's ${key} must be ${wholeTime}; got ${JSON.stringify(packet[key])}.`);
  if(packet.asOf<packet.at) throw Error("The case's asOf (review time) must not be earlier than its at (event time).");
  if(!Array.isArray(packet.records)) throw Error("The case's records must be a list.");
  packet.records.forEach((r,i)=>{
    const where=`Record ${i+1}`;
    if(!r || typeof r!=="object" || Array.isArray(r)) throw Error(`${where} must be an object with ${RECORD_FIELDS.join(", ")}.`);
    const unknown=Object.keys(r).find(key=>!RECORD_FIELDS.includes(key));
    if(unknown!==undefined) throw Error(`${where} has unknown field ${unknown}. Use ${RECORD_FIELDS.join(", ")}.`);
    const absent=RECORD_FIELDS.find(key=>!(key in r));
    if(absent!==undefined) throw Error(`${where} has no ${absent}.`);
    for(const key of ["subject","source","by"]) if(typeof r[key]!=="string" || !r[key])
      throw Error(`${where}'s ${key} must be non-empty text.`);
    for(const key of ["at","recorded"]) if(!Number.isSafeInteger(r[key]))
      throw Error(`${where}'s ${key} must be ${wholeTime}; got ${JSON.stringify(r[key])}.`);
  });
}

// Index record provenance once. Read values only for the binding the caller requests.
export function recordReader(edition,packet,onRead) {
  checkCase(packet);
  const byFact=new Map();
  for(const r of packet.records) {
    if (!r || typeof r.source !== "string" || typeof r.by !== "string") continue;
    const fact = edition.fields.get(r.source+"@"+r.by);
    const binding = edition.bindings.get(fact);
    if (!binding || !visibleAtReview(r,packet,binding.standing,binding.atEvent)) continue;
    if(!byFact.has(fact)) byFact.set(fact,[]);
    byFact.get(fact).push(r);
  }
  return fact => {
    const binding=edition.bindings.get(fact);
    if(!binding) throw Error("Declare an evidence source and owner for "+fact);
    let rows=byFact.get(fact) ?? [];
    let value;
    let problem;
    // A late correction to an older period cannot undo a newer effective decision.
    if (binding.standing && rows.length) {
      const effective = rows.reduce((last,row)=>Math.max(last,row.at),-Infinity);
      rows = rows.filter(row=>row.at===effective);
    }
    // "within N" counts only records written in the last N time units before the review.
    if (binding.within!==undefined && rows.length) {
      rows=rows.filter(row=>packet.asOf-row.recorded<=binding.within);
      if (!rows.length) problem = {reason:"expired_evidence"};
    }
    // "latest" lets the most recently written record replace earlier ones. Records written at
    // the same time that disagree still conflict.
    if ((binding.latest || binding.standing) && rows.length) {
      const last=rows.reduce((most,row)=>Math.max(most,row.recorded),-Infinity);
      rows=rows.filter(row=>row.recorded===last);
    }
    if (rows.length) {
      if (!rows.every(row=>validObservation(fact,binding,row.value))) {
        problem = {reason:"invalid_evidence"};
      } else if (rows.some(row=>row.value!==rows[0].value)) {
        if (onRead) problem = {reason:"conflicting_evidence",observations:conflictEvidence(rows,binding)};
      } else {
        value = rows[0].value;
      }
    }
    onRead?.(fact,binding,rows,problem);
    return value;
  };
}

export function decide(source,packet,{explain=false}={}) {
  const edition=readEdition(source), known=new Map(), problems=new Map();
  // A misspelled field would otherwise be ignored and leave an unexplained hold.
  if(packet && typeof packet==="object" && !Array.isArray(packet)) {
    const unknown=Object.keys(packet).find(key=>!["subject","at","asOf","records"].includes(key));
    if(unknown!==undefined) throw Error("Unknown field in the case: "+unknown+". Use subject, at, asOf and records.");
  }
  const read=recordReader(edition,packet,(fact,binding,rows,problem)=>{
    if (problem) problems.set(fact,problem);
  });
  const need=fact=>({fact,...edition.bindings.get(fact),...problems.get(fact)});
  for (const fact of edition.used) {
    const value=read(fact);
    if (value!==undefined) known.set(fact,value);
  }
  const actions=Object.create(null), budget={used:0};
  for(const id of edition.rules.keys()) {
    const axes=partitions(id,[edition],known), results=[];
    // Past a few hundred combinations the diagram is faster than listing them.
    if(!affordableEnumeration(axes,budget,DECIDE_ENUMERATION)) {
      const diagram=buildDiagram(axes,budget);
      const root=compileAnswers(diagram,edition,axes)(id);
      if(root<2) actions[id]={status:root?"release":"withhold"};
      else {
        // In a reduced ordered diagram, a variable is essential precisely when
        // a reachable node tests it. A known value has a single branch and disappears.
        const pending=[root], seen=new Set(), support=new Set();
        while(pending.length) {
          const index=pending.pop();
          if(index<2 || seen.has(index)) continue;
          seen.add(index);
          const {level,branches}=diagram.nodes[index];
          support.add(level);
          for(const child of branches) pending.push(child);
        }
        const needs=axes.flatMap(([fact],i)=>support.has(i)?[need(fact)]:[]);
        actions[id]={status:"hold",needs};
      }
      continue;
    }
    worlds(axes,budget,input=>{results.push(evaluate(edition,id,input));});
    const needs=[];
    let stride=1;
    for(let i=axes.length-1;i>=0;i--) {
      const [fact,values]=axes[i];
      if(values.length>1 && results.some((v,row)=>v!==results[row-(Math.floor(row/stride)%values.length)*stride]))
        needs.unshift(need(fact));
      stride*=values.length;
    }
    actions[id]=needs.length?{status:"hold",needs}:{status:results[0]?"release":"withhold"};
  }
  if (!explain) return actions;
  const sources = new Set([...edition.bindings.values()].map(binding=>binding.source));
  const undeclaredSourceRecords = packet.records.filter(row=>visibleAtReview(row,packet) &&
    typeof row.source === "string" && !sources.has(row.source)).length;
  return {actions,undeclaredSourceRecords};
}

export function bindingFeedback(changes) {
  function display(binding) {
    if (!binding) return "undeclared";
    const terms = [binding.owner];
    if (binding.standing) terms.push(binding.atEvent ? "standing at event" : "standing");
    if (binding.latest) terms.push("latest");
    if (binding.within !== undefined) terms.push("within " + binding.within);
    return binding.source + " (" + terms.join(", ") + ")";
  }
  return changes.map(c=>"Evidence for "+c.id+" · before: "+display(c.before)+" → after: "+display(c.after)).join("\n");
}
