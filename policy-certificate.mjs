// Verify a controller proposed by another tool against the supplied physical
// operations. At runtime the controller sees only its own node and returned bits.
import {symbolicOrigins} from "./factored-origins.mjs";
import {clauseOrigins} from "./clause-origins.mjs";
const isMap=x=>x!==null && typeof x==="object" && !Array.isArray(x);
const exact=(o,keys)=>isMap(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const bounded=(n,l,h)=>Number.isSafeInteger(n)&&n>=l&&n<=h;
const name=s=>typeof s==="string" && s.length>0 && s.length<=512;
const UNKNOWN=undefined;

export class PhysicalInputLimit extends Error {}

export function sourceModel(m,spend) {
  spend();
  if (!exact(m,["format","variables","initial","goal","safe","commands"])||m.format!=="factored-control/1"||
      !Array.isArray(m.variables)||m.variables.length===0) throw Error("Invalid finite variable domains.");
  if (m.variables.length>256) throw new PhysicalInputLimit("Source exceeds 256 physical variables.");
  spend(m.variables.length);
  if (!m.variables.every(v=>Number.isSafeInteger(v)&&v>=1)) throw Error("Invalid finite variable domains.");
  if (m.variables.some(v=>v>65536)) throw new PhysicalInputLimit("Physical variable exceeds 65536 values.");
  const atom=p=>Array.isArray(p)&&p.length===2&&bounded(p[0],0,m.variables.length-1)&&bounded(p[1],0,m.variables[p[0]]-1);
  let size=0;
  function formula(f,depth=0) {
    spend();
    if (++size>500000||depth>64) throw new PhysicalInputLimit("Condition exceeds the supported input size.");
    if (typeof f==="boolean"||atom(f)) return;
    if (!isMap(f)||Object.keys(f).length!==1) throw Error("Invalid condition.");
    if (Object.hasOwn(f,"not")) {formula(f.not,depth+1);return;}
    const k=Object.keys(f)[0];
    if (!["all","any","one"].includes(k)||!Array.isArray(f[k])) throw Error("Unknown condition.");
    for (const child of f[k]) formula(child,depth+1);
  }
  formula(m.initial);formula(m.goal);formula(m.safe);
  if (!Array.isArray(m.commands)) throw Error("Invalid command list.");
  if (m.commands.length>20000) throw new PhysicalInputLimit("Source exceeds 20000 physical commands.");
  const commands=new Map();
  for (const c of m.commands) {
    spend();
    if (!exact(c,["name","cost","requires","outcomes","observe"])||!name(c.name)||commands.has(c.name)||
        !bounded(c.cost,0,1e9)||!Array.isArray(c.outcomes)||!c.outcomes.length||!Array.isArray(c.observe)||
        c.observe.length>128||!c.observe.every(atom)) throw Error("Invalid physical command.");
    spend(c.observe.length);
    formula(c.requires);
    for (const effects of c.outcomes) {
      if (!Array.isArray(effects)) throw Error("Invalid command outcome.");
      for (const e of effects) {
        spend();
        if (!exact(e,["when","write"])||!atom(e.write)) throw Error("Invalid conditional write.");
        formula(e.when);
      }
    }
    commands.set(c.name,c);
  }
  return commands;
}

export function truth(f,world,spend) {
  spend();
  if (typeof f==="boolean") return f;
  if (Array.isArray(f)) return world[f[0]]===UNKNOWN?UNKNOWN:world[f[0]]===f[1];
  if (Object.hasOwn(f,"not")) {
    const b=truth(f.not,world,spend);return b===UNKNOWN?UNKNOWN:!b;
  }
  const k=Object.keys(f)[0];let yes=0,missing=false;
  for(const child of f[k]) {
    const b=truth(child,world,spend);
    if (b===UNKNOWN) missing=true;
    else if (b) {yes++;if (k==="any") return true;if(k==="one"&&yes>1)return false;}
    else if(k==="all") return false;
  }
  return missing?UNKNOWN:k==="all"||k==="one"&&yes===1;
}

function controller(p,commands,spend) {
  spend();
  if (!exact(p,["initial","nodes"])||!Array.isArray(p.nodes)||!bounded(p.nodes.length,1,100000)||
      !bounded(p.initial,0,p.nodes.length-1)) throw Error("Invalid controller origin or nodes.");
  return p.nodes.map(n=>{
    spend();
    if(exact(n,["finish"])&&n.finish===true)return null;
    if (!exact(n,["command","branches"])||!commands.has(n.command)||!Array.isArray(n.branches)) throw Error("Invalid controller operation.");
    const op=commands.get(n.command), routes=new Map();
    for (const branch of n.branches) {
      spend(1+op.observe.length);
      if (!exact(branch,["signal","next"])||typeof branch.signal!=="string"||
          branch.signal.length!==op.observe.length||/[^01]/.test(branch.signal)||routes.has(branch.signal)||
          !bounded(branch.next,0,p.nodes.length-1)) throw Error("A branch must use just the observed bits and name one successor.");
      routes.set(branch.signal,branch.next);
    }
    return {op,routes};
  });
}

class Inconclusive extends Error {}
class Counterexample extends Error {
  constructor(reason,trace) {super(reason);this.trace=trace;}
}

export function certifyPolicy(model,proposal,terms={}) {
  if (!isMap(terms)||Object.keys(terms).some(k=>!["budget","workLimit","project","origins"].includes(k))) throw Error("Invalid execution terms.");
  const budget=terms.budget??Number.MAX_SAFE_INTEGER,workLimit=terms.workLimit??1000000;
  if (!bounded(budget,0,Number.MAX_SAFE_INTEGER)||!bounded(workLimit,1,200000000)) throw Error("Invalid execution or verification allowance.");
  if (terms.project!==undefined && typeof terms.project!=="boolean") throw Error("project must be Boolean");
  if (terms.origins!==undefined && !["enumerate","constraints"].includes(terms.origins)) throw Error("Invalid origin method.");
  let used=0,worlds=0,edges=0;
  const spend=(n=1)=>{if(n>workLimit-used) throw new Inconclusive("verification work limit reached");used+=n;};
  let commands,nodes;
  try { commands=sourceModel(model,spend); nodes=controller(proposal,commands,spend); }
  catch(e) {
    if(e instanceof Inconclusive || e instanceof PhysicalInputLimit)return {status:"hold",reason:e.message,verificationWork:used,phase:"input_validation"};
    throw e;
  }
  const inputValidationWork=used;
  // An omitted coordinate is initially free and no command of this controller
  // reads, senses or writes it. Every assignment to the omitted coordinates
  // therefore lifts the very same observable run. Keep coordinates mentioned
  // even under negation and conditional effects.
  let retained=null, copies=1n, projectionWork=0;
  if (terms.project) {
    retained=new Set();
    function read(f) {
      spend();
      if (Array.isArray(f))retained.add(f[0]);
      else if (isMap(f)) {
        const [k]=Object.keys(f);
        if (k==="not")read(f.not);
        else for(const child of f[k])read(child);
      }
    }
    try {
      read(model.initial);read(model.safe);read(model.goal);
      for(const n of new Set(nodes.filter(Boolean).map(x=>x.op))) {
        read(n.requires);
        for(const o of n.observe)read(o);
        for(const path of n.outcomes)for(const e of path){read(e.when);read(e.write);}
      }
      for(const [i,size] of model.variables.entries()){spend();if(!retained.has(i))copies*=BigInt(size);}
      projectionWork=used-inputValidationWork;
    } catch(e) {
      if(e instanceof Inconclusive)return {status:"hold",reason:e.message,verificationWork:used};
      throw e;
    }
  }
  const memo=new Map(), active=new Map();
  function successor(input,effects) {
    const output=input.slice(),written=new Map();
    for (const e of effects) if (truth(e.when,input,spend)) {
      const [i,v]=e.write;
      if (written.has(i)&&written.get(i)!==v) throw new Inconclusive("the source has conflicting simultaneous writes");
      written.set(i,v);output[i]=v;
    }
    return output;
  }
  function visit(rootWorld) {
    // Explicit stack so a long valid proposal cannot overrun the JS call stack.
    const stack=[];
    function frame(world,id,incoming) {
      spend();
      const k=id+"/"+world.join(",");
      return {k,world,id,incoming,built:false,choices:[],i:0,value:0};
    }
    const initial=frame(rootWorld,proposal.initial,null);
    if (memo.has(initial.k)) return memo.get(initial.k).value;
    stack.push(initial);
    const trace=extra=>({initialWorld:rootWorld,steps:stack.slice(1).map(x=>x.incoming),...extra});
    while (stack.length) {
      const n=stack.at(-1), action=nodes[n.id];
      if (!n.built) {
        active.set(n.k,stack.length-1);
        if (!truth(model.safe,n.world,spend)) throw new Counterexample("an admitted path crosses the safety condition",trace({node:n.id}));
        if (!action) {
          if (!truth(model.goal,n.world,spend)) throw new Counterexample("the proposal finishes before the demand holds",trace({node:n.id}));
        } else {
          const c=action.op;
          if (!truth(c.requires,n.world,spend)) throw new Counterexample("the proposed action is unavailable in an admitted history",trace({node:n.id,command:c.name}));
          for(const [outcome,effects] of c.outcomes.entries()) {
            spend();
            const next=successor(n.world,effects);
            const signal=c.observe.map(([v,val])=>next[v]===val?"1":"0").join("");
            const nextNode=action.routes.get(signal),step={command:c.name,signal,outcome};
            if (nextNode===undefined) throw new Counterexample("the receiver can return a signal the proposal does not handle",trace({node:n.id,missing:step}));
            n.choices.push(frame(next,nextNode,step));edges++;
          }
        }
        n.built=true;
      }
      if (n.i<n.choices.length) {
        const child=n.choices[n.i];
        if (active.has(child.k)) throw new Counterexample("an admitted outcome can repeat forever",trace({repeatFrom:active.get(child.k),closing:child.incoming}));
        if (!memo.has(child.k)) {stack.push(child);continue;}
        const price=action.op.cost+memo.get(child.k).value;
        if (!Number.isSafeInteger(price)) throw new Inconclusive("execution cost exceeds the exact integer range");
        if (!n.best||price>n.value){n.value=price;n.best=child;}
        n.i++;continue;
      }
      memo.set(n.k,{value:n.value,next:n.best?{key:n.best.k,step:n.best.incoming}:null});
      active.delete(n.k);stack.pop();
    }
    return memo.get(initial.k).value;
  }
  let max=-1, worst;
  const assignment=Array(model.variables.length).fill(UNKNOWN);
  function visitOrigin(w) {
    const cost=visit(w);worlds++;
    if (cost>max){max=cost;worst=w;}
  }
  function starts(i) {
    if (truth(model.initial,assignment,spend)===false) return;
    if(i===assignment.length) {
      visitOrigin(assignment.slice());return;
    }
    const width=retained && !retained.has(i)?1:model.variables[i];
    for(let v=0;v<width;v++){assignment[i]=v;starts(i+1);}
    assignment[i]=UNKNOWN;
  }
  let originMethod;
  const counts=()=>({inputValidationWork,...(originMethod?{originMethod}:{}),checkedOrigins:worlds,checkedPairs:memo.size,transitions:edges,verificationWork:used,...(retained?{projectionWork,
    retainedCoordinates:[...retained].sort((a,b)=>a-b),originalCoordinates:model.variables.length,
    freeAssignmentsPerRepresentative:String(copies)}:{})});
  try {
    if (terms.origins==="constraints") {
      originMethod=clauseOrigins(model,retained,spend,visitOrigin);
      if (!originMethod) originMethod={method:"decision_diagram",...symbolicOrigins(model,retained,spend,visitOrigin)};
    } else starts(0);
  }
  catch(e) {
    if(e instanceof Counterexample)return {status:"invalid_policy",reason:e.message,witness:e.trace,...counts()};
    if(e instanceof Inconclusive || /^Symbolic (state|operation) budget exhausted/.test(e.message))
      return {status:"hold",reason:e instanceof Inconclusive?e.message:"origin decision diagram limit reached",...counts()};
    throw e;
  }
  if (max<0)return {status:"hold",reason:"the source declares no possible initial state",...counts()};
  const longest=[];let k=proposal.initial+"/"+worst.join(",");
  while(memo.get(k).next){const move=memo.get(k).next;longest.push(move.step);k=move.key;}
  return {status:max>budget?"over_budget":"certified_policy",worstExecutionCost:max,budget,...counts(),
    ...(retained?{originalInitialWorldsCovered:String(BigInt(worlds)*copies)}:{}),
    worstWitness:{initialWorld:worst,steps:longest},scope:"supplied finite physical model, fixed signal-only controller, all possible initial states and outcomes"};
}
