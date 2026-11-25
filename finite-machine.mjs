// A compact deterministic machine. Even diagram levels are current variables;
// odd levels are temporary next-state variables used for forward reachability.
import {readEdition,validObservation} from "./contract-language.mjs";
import {DecisionDiagram,compileAnswers} from "./decision-diagram.mjs";

const object = o=>o!==null && typeof o==="object" && !Array.isArray(o);
function shape(o,allowed,label) {
  if(!object(o) || Object.keys(o).some(k=>!allowed.includes(k))) throw Error("Invalid "+label+".");
}
const validName=n=>typeof n==="string" && /^[a-z][a-z0-9_]{0,39}$/.test(n);
const current=i=>2*i;
const next=i=>2*i+1;

function variableDomain(edition,name,spec) {
  const binding=edition.bindings.get(name);
  if(!binding) throw Error("Declare a source for variable "+name);
  if(!binding.unit && spec==="boolean") return [false,true];
  let values=spec;
  if(object(spec)) {
    shape(spec,["range"],"variable range");
    const ends=spec.range;
    if(!Array.isArray(ends) || ends.length!==2 || !ends.every(Number.isSafeInteger) ||
        ends[1]<ends[0] || ends[1]-ends[0]>=128) throw Error("Supply an ordered range of at most 128 values for "+name);
    values=Array.from({length:ends[1]-ends[0]+1},(_,i)=>ends[0]+i);
  }
  if(!Array.isArray(values) || !values.length || values.length>128 || new Set(values).size!==values.length ||
    !values.every(v=>validObservation(name,binding,v))) throw Error("Invalid finite domain for "+name);
  return [...values].sort((a,b)=>Number(a)-Number(b));
}

export function compileMachine(source,spec,shared) {
  shape(spec,["form","variables","initial","admissible","questions","actions","observe","offers","budget"],"variable regime");
  if(spec.form!=="finite-variables/1" || !object(spec.variables)) throw Error("Declare finite-variables/1 and its variables.");
  const edition=readEdition(source);
  const byName=([a],[b])=>a<b?-1:a>b?1:0;
  const axes=Object.entries(spec.variables).sort(byName).map(([name,domain])=>[name,variableDomain(edition,name,domain)]);
  if(!axes.length || axes.length>128) throw Error("Supply 1–128 finite variables.");
  const slots=new Map(axes.map(([name],i)=>[name,i]));
  const descriptor=axes.map(([name,values])=>[name,edition.bindings.get(name).unit??null,values]);
  const d=shared?.d??new DecisionDiagram(axes.flatMap(([,v])=>[v.length,v.length]),undefined,undefined,
    {nodes:2000000, edges:20000000, calls:20000000});
  if(shared && JSON.stringify(descriptor)!==JSON.stringify(shared.descriptor)) throw Error("Changed machine input domain or unit requires a migration.");
  const getAnswer=compileAnswers(d,edition,axes,current);
  function rule(name) {
    if(!edition.rules.has(name)) throw Error("Name a declared guarantee: "+name);
    for(const fact of edition.dependencies.get(name).keys()) if(!slots.has(fact)) throw Error("Declare a finite machine domain for "+fact);
    return getAnswer(name);
  }
  if(!Array.isArray(spec.questions) || !spec.questions.length || spec.questions.length>16 ||
     new Set(spec.questions).size!==spec.questions.length) throw Error("Supply 1–16 distinct questions.");
  const outputs=spec.questions.map(rule);
  const domain=Object.hasOwn(spec,"admissible")?rule(spec.admissible):1;
  const initial=Object.hasOwn(spec,"initial")?rule(spec.initial):domain;
  if(!initial || d.and(initial,d.not(domain))) throw Error("Initial states must be a nonempty subset of the admissible states.");
  const observed=spec.observe??[], offers=spec.offers??{}, budget=spec.budget??0;
  if(!Array.isArray(observed) || new Set(observed).size!==observed.length || observed.some(f=>!slots.has(f)) ||
     !object(offers) || Object.keys(offers).length>12 || !Number.isSafeInteger(budget) || budget<0 ||
     Object.entries(offers).some(([f,v])=>!slots.has(f) || observed.includes(f) || !Number.isSafeInteger(v) || v<1 || v>1e9))
    throw Error("Invalid regime observations, offered readings or budget.");
  const eqCache=new Map();
  function equality(i,value) {
    const axis=axes[i][1],index=axis.indexOf(value);
    if(index<0) return 0;
    const key=i+":"+index;
    if(!eqCache.has(key)) eqCache.set(key,d.make(current(i),axis.map(v=>Number(v===value))));
    return eqCache.get(key);
  }
  // Return mutually exclusive predicates, one per possible destination value.
  // Their union identifies the states on which this expression is defined.
  function update(target,expr,depth=0) {
    if(depth>16) throw Error("Action expressions support at most 16 nested conditions.");
    const [targetName,values]=axes[target];
    if(typeof expr==="boolean" || Number.isSafeInteger(expr)) {
      if(!validObservation(targetName,edition.bindings.get(targetName),expr)) throw Error("Invalid action literal for "+targetName);
      return values.map(v=>Number(v===expr));
    }
    if(!object(expr)) throw Error("Invalid assignment for "+targetName);
    if(Object.hasOwn(expr,"if")) {
      shape(expr,["if","then","else"],"conditional assignment");
      const cond=rule(expr.if),a=update(target,expr.then,depth+1),b=update(target,expr.else,depth+1);
      return a.map((v,j)=>d.ite(cond,v,b[j]));
    }
    if(Object.hasOwn(expr,"rule")) {
      shape(expr,["rule"],"Boolean assignment");
      if(edition.bindings.get(targetName).unit) throw Error("A Boolean rule cannot set quantity "+targetName);
      const pred=rule(expr.rule);
      return values.map(v=>v?pred:d.not(pred));
    }
    shape(expr,["from","plus"],"variable assignment");
    const from=slots.get(expr.from);
    if(from===undefined || edition.bindings.get(expr.from).unit!==edition.bindings.get(targetName).unit)
      throw Error("Copy requires variables with identical units: "+targetName);
    const increment=Object.hasOwn(expr,"plus");
    if(increment && (!edition.bindings.get(targetName).unit || !Number.isSafeInteger(expr.plus)))
      throw Error("Use an exact integer increment on a quantity.");
    return values.map(v=>{
      if(!increment) return equality(from,v);
      // Safe inverse arithmetic only; a successor outside the declared domain
      // remains undefined and is checked on reachable enabled transitions.
      const old=BigInt(v)-BigInt(expr.plus);
      return old<BigInt(Number.MIN_SAFE_INTEGER)||old>BigInt(Number.MAX_SAFE_INTEGER)?0:equality(from,Number(old));
    });
  }
  if(!object(spec.actions) || Object.keys(spec.actions).length>16) throw Error("Declare at most 16 named actions.");
  const actions=Object.entries(spec.actions).sort(byName).map(([name,def])=>{
    if(!validName(name)) throw Error("Invalid action name.");
    shape(def,["enabledWhen","set"],"action");
    const enabled=Object.hasOwn(def,"enabledWhen")?rule(def.enabledWhen):1;
    const sets=def.set??{};
    if(!object(sets) || Object.keys(sets).some(f=>!slots.has(f))) throw Error("Action sets an undeclared variable.");
    const images=new Map();
    let valid=1;
    for(const [key,expr] of Object.entries(sets)) {
      const i=slots.get(key),ranges=update(i,expr);
      images.set(i,ranges);
      valid=d.and(valid,ranges.reduce((a,b)=>d.or(a,b),0));
    }
    // Composition is simultaneous. Replacements refer to the old state.
    const cache=new Map([[0,0],[1,1]]);
    function pre(root) {
      if(cache.has(root)) return cache.get(root);
      const node=d.nodes[root], i=node.level/2;
      if(!Number.isInteger(i)) throw Error("Unexpected next-state variable.");
      const tests=images.get(i);
      const children=node.branches.map(pre);
      let mapped;
      if(!tests && children.every(c=>c<2 || d.nodes[c].level>node.level)) mapped=d.make(node.level,children);
      else mapped=children.reduce((sum,c,j)=>d.or(sum,d.and(c,tests?tests[j]:equality(i,axes[i][1][j]))),0);
      cache.set(root,mapped);return mapped;
    }
    let relation;
    // Build a relation only when a restricted start requires an image.
    function relationFor() {
      if(relation!==undefined) return relation;
      relation=enabled;
      for(let i=axes.length-1;i>=0;i--) {
        const vs=axes[i][1],tests=images.get(i);
        const equalsNext=vs.map((_,j)=>d.make(next(i),vs.map((v,k)=>Number(j===k))));
        let matched;
        if(!tests) matched=d.make(current(i),equalsNext);
        else matched=tests.reduce((sum,src,j)=>d.or(sum,d.and(src,equalsNext[j])),0);
        relation=d.and(relation,matched);
      }
      return relation;
    }
    return {name,enabled,pre,relationFor,invalid:d.and(enabled,d.not(d.and(valid,pre(domain))))};
  });
  function witness(root) {
    const digits=d.first(root);
    if(!digits) return undefined;
    return Object.fromEntries(axes.map(([name,vals],i)=>[name,vals[digits[current(i)]]]));
  }
  const eraseCache=new Map([[0,0],[1,1]]);
  function eraseCurrent(root) {
    if(eraseCache.has(root)) return eraseCache.get(root);
    const node=d.nodes[root],children=node.branches.map(eraseCurrent);
    const v=node.level%2===0?children.reduce((a,b)=>d.or(a,b),0):d.make(node.level-1,children);
    eraseCache.set(root,v);return v;
  }
  let reachable=initial,frontier=initial,rounds=0;
  for(;;) {
    for(const action of actions) {
      const bad=d.and(frontier,action.invalid);
      if(bad) throw Error("Action "+action.name+" leaves its admissible domain at "+JSON.stringify(witness(bad)));
    }
    if(reachable===domain || !frontier) break;
    if(++rounds>4096) throw Error("Reached the 4096-step symbolic reachability limit. No verdict.");
    let neighbors=0;
    for(const action of actions) neighbors=d.or(neighbors,eraseCurrent(d.and(frontier,action.relationFor())));
    frontier=d.and(neighbors,d.not(reachable));reachable=d.or(reachable,frontier);
  }
  // Domain reached on the most recent iteration may still contain unchecked
  // outgoing transitions; the final frontier above is checked before exiting.
  const countCache=new Map();
  const products=Array(axes.length+1).fill(1n);
  for(let i=axes.length-1;i>=0;i--) products[i]=products[i+1]*BigInt(axes[i][1].length);
  function count(root,slot=0) {
    if(!root) return 0n;
    if(root===1) return products[slot];
    const node=d.nodes[root],i=node.level/2;
    if(!Number.isInteger(i) || i<slot) throw Error("Malformed state counting order.");
    if(!countCache.has(root)) countCache.set(root,node.branches.reduce((s,b)=>s+count(b,i+1),0n));
    return products[slot]/products[i]*countCache.get(root);
  }
  function forward(region,action,accepted=true) {
    if(!accepted) return d.and(region,d.not(action.enabled));
    return eraseCurrent(d.and(region,action.relationFor()));
  }
  return {edition,axes,slots,descriptor,d,outputs,domain,initial,actions,reachable,rounds,count,witness,equality,observed,offers,budget,forward};
}
