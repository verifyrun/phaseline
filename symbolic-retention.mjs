import {compileMachine} from "./finite-machine.mjs";
import {observationTimes,recordReader} from "./evidence-source.mjs";

const bits=n=>Math.ceil(Math.log2(n));
const isObject=o=>o!==null && typeof o==="object" && !Array.isArray(o);

function quotient(machine,questions) {
  const {d,reachable,actions,outputs,count,witness,axes}=machine;
  // Each emitted class carries an example on every axis, all answers and all successors.
  const classLimit=Math.max(2048, Math.floor(131072 / (1 + axes.length + outputs.length + actions.length)));
  const candidates=outputs.map((root,i)=>({root,question:questions[i]}));
  for(const a of actions) candidates.push({root:a.enabled,availability:a.name});
  const root={region:reachable};
  let leaves=[root],work=0;
  const seen=new Set();
  function charge(n=1) {
    work+=n;
    if(work>10000000) throw Error("Symbolic quotient work limit exceeded. No minimum reported.");
  }
  for(let i=0;i<candidates.length;i++) {
    const pred=candidates[i].root;
    const key=d.and(reachable,pred);
    if(key===0 || key===reachable || seen.has(key)) continue;
    seen.add(key);
    seen.add(d.and(reachable,d.not(pred)));
    let useful=false;
    const refined=[];
    const neg=d.not(pred);
    for(const cell of leaves) {
      charge();
      const yes=d.and(cell.region,pred),no=d.and(cell.region,neg);
      if(yes && no) {
        useful=true;
        cell.test=pred;
        cell.yes={region:yes};
        cell.no={region:no};
        refined.push(cell.no,cell.yes);
      } else refined.push(cell);
      if(refined.length>classLimit) throw Error("Retained codebook exceeds its output budget ("+classLimit+" classes for this shape). No minimum reported.");
    }
    if(!useful) continue;
    leaves=refined;
    for(const a of actions) candidates.push({root:d.ite(a.enabled,a.pre(pred),pred)});
  }
  function truth(test,world) {
    while(test>1) {
      const node=d.nodes[test], [name,domain]=axes[node.level/2];
      const value=domain.indexOf(world[name]);
      if(value<0) throw Error("Input outside its finite domain.");
      test=node.branches[value];
    }
    return Boolean(test);
  }
  function classify(evaluate) {
    let cell=root;
    while(cell.test!==undefined) {
      charge();
      cell=evaluate(cell.test)?cell.yes:cell.no;
    }
    return cell.code;
  }
  leaves.forEach((cell,i)=>{cell.code=i;});
  const classes=leaves.map(cell=>{
    const example=witness(cell.region);
    const answers=outputs.map(f=>truth(f,example));
    const next=actions.map(a=>truth(a.enabled,example)?classify(t=>truth(a.pre(t),example)):null);
    return {code:cell.code,count:count(cell.region).toString(),example,answers,next};
  });
  const free=new Set(machine.observed.map(k=>machine.slots.get(k)));
  const cache=new Map([[0,0],[1,1]]);
  function project(n) {
    if(cache.has(n)) return cache.get(n);
    const node=d.nodes[n],br=node.branches.map(project);
    const result=free.has(node.level/2)?d.make(node.level,br):br.reduce((a,b)=>d.or(a,b),0);
    cache.set(n,result);
    return result;
  }
  let covered=0,encoder={status:"encodable",observe:machine.observed};
  for(const cell of leaves) {
    const projected=project(cell.region), overlap=d.and(covered,projected);
    if(overlap) {
      const obs=witness(overlap);
      const observation=Object.fromEntries(machine.observed.map(k=>[k,obs[k]]));
      const fixed=Object.entries(observation).reduce((v,[k,x])=>d.and(v,machine.equality(machine.slots.get(k),x)),1);
      const previous=leaves.slice(0,cell.code).find(c=>d.and(fixed,c.region));
      encoder={status:"unavailable_from_snapshot",observation,
        examples:[witness(d.and(previous.region,fixed)),witness(d.and(cell.region,fixed))],
        experiment:distinguish(classes,questions,actions,previous.code,cell.code)};
      break;
    }
    covered=d.or(covered,projected);
  }
  return {leaves,root,classes,encoder,truth,classify,fixedWidthBits:bits(classes.length)};
}

// A refusal is observed on requesting an unavailable action. Refused attempts
// leave the physical state unchanged. This search charges such a request as a
// step, unlike an immediately readable Boolean outcome.
function distinguish(classes,questions,actions,a,b) {
  const queue=[{a,b,parent:-1}],seen=new Set([a+","+b]);
  function word(i,end) {
    const steps=end?[end]:[];
    while(queue[i].parent>=0){steps.push(queue[i].step);i=queue[i].parent;}
    return steps.reverse();
  }
  let refusal=null;
  for(let i=0;i<queue.length;i++) {
    const item=queue[i],x=classes[item.a],y=classes[item.b],steps=word(i);
    if(refusal && refusal.after.length<=steps.length) {
      // Inspect all nodes at this depth for a Boolean distinction of the same
      // length only if needed; the already found refusal is also minimal.
      return refusal;
    }
    const j=x.answers.findIndex((v,k)=>v!==y.answers[k]);
    if(j>=0) return {after:steps,question:questions[j],answers:[x.answers[j],y.answers[j]]};
    for(let k=0;k<actions.length;k++) {
      const l=x.next[k],r=y.next[k],action=actions[k].name;
      if((l===null)!==(r===null)) {
        refusal??={after:word(i,action),question:"action accepted",action,answers:[l!==null,r!==null]};
      } else if(l!==null && l!==r) {
        const key=l+","+r;
        if(!seen.has(key)) {
          if(seen.size>=200000) throw Error("Distinguishing-word search exhausted its work budget.");
          seen.add(key);queue.push({a:l,b:r,parent:i,step:action});
        }
      }
    }
  }
  if(refusal) return refusal;
  throw Error("Could not replay a distinguishing experiment.");
}

function checkCommon(before,after) {
  const {d,reachable}=before;
  for(const [name] of before.axes) {
    if(JSON.stringify(before.edition.bindings.get(name))!==JSON.stringify(after.edition.bindings.get(name)))
      throw Error("Changed binding for "+name+". Supply a source migration.");
  }
  if(before.initial!==after.initial || before.reachable!==after.reachable)
    throw Error("Initial or reachable set changed. Supply a model migration.");
  for(let i=0;i<before.actions.length;i++) {
    const a=before.actions[i],b=after.actions[i];
    if(d.and(reachable,d.xor(a.enabled,b.enabled))) throw Error("Enabled actions changed. Supply a model migration.");
    for(let slot=0;slot<before.axes.length;slot++) for(const value of before.axes[slot][1]) {
      const test=before.equality(slot,value);
      if(d.and(reachable,d.and(a.enabled,d.xor(a.pre(test),b.pre(test)))))
        throw Error("Action "+a.name+" has changed transitions. Supply a model migration.");
    }
  }
}
function exported(q) {return {classes:q.classes,fixedWidthBits:q.fixedWidthBits,encoder:q.encoder};}

export function symbolicRetain(source,spec,proposed) {
  const before=compileMachine(source,spec);
  const old=quotient(before,spec.questions);
  const result={scope:"declared_reachable_finite_variables",states:before.count(before.reachable).toString(),
    questions:spec.questions,actions:before.actions.map(a=>a.name),issued:exported(old)};
  if(proposed===undefined) return result;
  const after=compileMachine(proposed,spec,before);
  checkCommon(before,after);
  const revised=quotient(after,spec.questions);
  const {d}=before;
  const decoder=[];
  let witness, visits=0;
  for(const o of old.leaves) {
    const row=[];
    // Skip whole disjoint subtrees. In matching books each old cell has one destination.
    const pending=[revised.root];
    while(pending.length) {
      if(++visits>10000000) throw Error("Cross-edition mapping work limit exceeded. No decoder reported.");
      const cell=pending.pop();
      if(!d.and(o.region,cell.region)) continue;
      if(cell.test===undefined) row.push(cell.code);
      else pending.push(cell.yes,cell.no);
    }
    if(row.length>1 && !witness) {
      const examples=row.slice(0,2).map(n=>before.witness(d.and(o.region,revised.leaves[n].region)));
      witness={oldCode:o.code,newCodes:row.slice(0,2),examples,
        experiment:distinguish(revised.classes,spec.questions,after.actions,row[0],row[1])};
    }
    decoder.push(row);
  }
  return {...result,proposed:exported(revised),migration:{basis:"actually_obtained_old_code_with_shared_codebook",
    status:witness?"old_code_insufficient":"old_code_suffices",decoder,extraFixedWidthBits:bits(Math.max(...decoder.map(a=>a.length))),
    ...(witness?{witness}:{})}};
}

// Apply a partial, source-bound record to reachable worlds. Asking the same
// field twice cannot help. A missing paid reading still consumes the tariff.
export function variableCodebook(source,spec) {
  const machine=compileMachine(source,spec);
  return {machine,quotient:quotient(machine,spec.questions)};
}

export function symbolicEncode(source,spec,packet) {
  const book=variableCodebook(source,spec);
  return encodeRegion(book,packet,book.machine.reachable,book.machine.budget);
}

export function encodeRegion(book,packet,region,limit) {
  const {machine:mach,quotient:q}=book, {d,equality,slots,axes,offers,observed,edition}=mach;
  const records=[];
  const read=recordReader(edition,packet,(fact,binding,items)=>records.push({fact,binding,records:items.map(row=>observationTimes(row,binding))}));
  const budget=Math.min(mach.budget,limit);
  const names=Object.keys(offers),evidence=[],memo=new Map();
  let possible=region,spent=0,edges=0;
  function eligible(region) {return q.leaves.filter(cell=>d.and(cell.region,region));}
  function plan(region,remaining) {
    const key=region+":"+remaining;
    if(memo.has(key)) return memo.get(key);
    if(++edges>100000) throw Error("Symbolic observation planning budget exhausted.");
    const candidates=eligible(region);
    if(candidates.length<=1) return {cost:0,code:candidates[0]?.code};
    let best={cost:Infinity};
    for(const [i,name] of names.entries()) {
      if(!(remaining&(1<<i)) || offers[name]>=best.cost) continue;
      const slot=slots.get(name);
      const groups=axes[slot][1].map(v=>d.and(region,equality(slot,v))).filter(Boolean);
      if(groups.length<2) continue;
      let worst=0;
      for(const g of groups) {
        worst=Math.max(worst,plan(g,remaining & ~(1<<i)).cost);
        if(offers[name]+worst>=best.cost) break;
      }
      const cost=offers[name]+worst;
      if(cost<best.cost) best={cost,i};
    }
    memo.set(key,best);
    return best;
  }
  function consume(name,charge) {
    const value=read(name);
    spent+=charge;
    evidence.push({fact:name,cost:charge,obtained:value!==undefined,...(value===undefined?{}:{value})});
    if(value!==undefined) possible=d.and(possible,equality(slots.get(name),value));
  }
  for(const name of observed) consume(name,0);
  let available=(1<<names.length)-1;
  for(;;) {
    const base={scope:"source_bound_packet_and_declared_reachable_states",spent,remaining:budget-spent,evidence,records};
    if(!possible) return {...base,status:"inconsistent"};
    const op=plan(possible,available);
    if(op.cost===0) return {...base,status:"encoded",code:op.code};
    if(!Number.isFinite(op.cost)) return {...base,status:"unresolved",possibleCodes:eligible(possible).map(c=>c.code)};
    if(op.cost>budget-spent) return {...base,status:"over_budget",worstCaseAdditionalCost:op.cost};
    const name=names[op.i];
    consume(name,offers[name]);available &=~(1<<op.i);
  }
}

// A separate sequence is checked against the same declared transition
// semantics. Empty evidence leaves alternatives open; an inconsistency
// makes no claim about which source, model or recorded event is mistaken.
export function symbolicChallenge(source,spec,trace) {
  const m=compileMachine(source,spec),{d,initial}=m;
  if(!isObject(trace) || Object.keys(trace).some(k=>k!=="steps") ||
     !Array.isArray(trace.steps) || !trace.steps.length || trace.steps.length>256) throw Error("Supply 1–256 recorded steps.");
  let belief=initial;
  const allowed=new Set(m.observed);
  for(const [i,step] of trace.steps.entries()) {
    if(!isObject(step) || Object.keys(step).some(k=>!["action","accepted","observe","answers"].includes(k)) ||
       !isObject(step.observe) || !isObject(step.answers)) throw Error("Invalid trace step.");
    if(i===0) {
      if(Object.hasOwn(step,"action") || Object.hasOwn(step,"accepted")) throw Error("Initial step must precede every action.");
    } else {
      const action=m.actions.find(a=>a.name===step.action);
      const accepted=Object.hasOwn(step,"accepted")?step.accepted:true;
      if(!action || typeof accepted!=="boolean") throw Error("Invalid recorded action or outcome.");
      belief=m.forward(belief,action,accepted);
    }
    const previous=belief;
    for(const [k,v] of Object.entries(step.observe)) {
      if(!allowed.has(k) || !m.axes[m.slots.get(k)][1].includes(v)) throw Error("Undeclared observation or value.");
      belief=d.and(belief,m.equality(m.slots.get(k),v));
    }
    for(const [name,v] of Object.entries(step.answers)) {
      const q=spec.questions.indexOf(name);
      if(q<0 || typeof v!=="boolean") throw Error("Invalid observed answer.");
      belief=d.and(belief,v?m.outputs[q]:d.not(m.outputs[q]));
    }
    if(!belief) return {scope:"supplied_variable_trace",status:"inconsistent",firstIncompatibleStep:i,
      possibleBeforeReading:m.count(previous).toString(),recorded:step};
  }
  return {scope:"supplied_variable_trace",status:"consistent",steps:trace.steps.length,remainingStates:m.count(belief).toString()};
}

// Transfer an old set of worlds using solely the named field equalities.
// Unmatched dimensions are existentially forgotten. This relation can be
// wrong about an external system even if an owner signed the statement.
export function correspondenceRegion(oldBook,newBook,oldCode,relation) {
  if(!isObject(relation) || Object.keys(relation).some(k=>!["form","equal"].includes(k)) ||
     relation.form!=="shared-variables/1" || !Array.isArray(relation.equal) || relation.equal.length>128)
    throw Error("Supply a signed shared-variables/1 correspondence.");
  const a=oldBook.machine,b=newBook.machine, pairs=[];
  const left=new Set(),right=new Set();
  for(const link of relation.equal) {
    if(!isObject(link) || Object.keys(link).length!==2 || !a.slots.has(link.from) || !b.slots.has(link.to) ||
       left.has(link.from) || right.has(link.to) || a.edition.bindings.get(link.from).unit!==b.edition.bindings.get(link.to).unit)
      throw Error("Correspondence must pair different declared fields once each with matching units.");
    left.add(link.from);right.add(link.to);
    pairs.push([a.slots.get(link.from),b.slots.get(link.to)]);
  }
  function transfer(source,target,root,mapping) {
    const map=new Map(mapping),cache=new Map([[0,0],[1,1]]);
    function walk(n) {
      if(cache.has(n)) return cache.get(n);
      const item=source.d.nodes[n],i=item.level/2;
      const children=item.branches.map(walk),slot=map.get(i);
      const res=children.reduce((sum,child,v)=>target.d.or(sum,slot===undefined?child:
        target.d.and(child,target.equality(slot,source.axes[i][1][v]))),0);
      cache.set(n,res);return res;
    }
    // Even a reduced source diagram that skips a constrained variable ranges
    // over only its own finite domain. Impose that domain in the destination.
    let result=walk(root);
    for(const [i,j] of mapping) {
      const valid=source.axes[i][1].reduce((pred,v)=>target.d.or(pred,target.equality(j,v)),0);
      result=target.d.and(result,valid);
    }
    return result;
  }
  const old=oldBook.quotient.leaves[oldCode];
  if(!Number.isSafeInteger(oldCode) || !old) throw Error("Unknown predecessor code.");
  const image=b.d.and(b.reachable,transfer(a,b,old.region,pairs));
  const covered=transfer(b,a,image,pairs.map(([x,y])=>[y,x]));
  const lost=a.d.and(old.region,a.d.not(covered));
  if(lost) return {status:"incomplete",unmatchedPredecessor:a.witness(lost)};
  return {status:"covered",image};
}
