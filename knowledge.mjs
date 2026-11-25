// Epistemic checks for a supplied finite transition system. A role sees only
// its named fields and signal labels. Actual one-time reads use the original
// evidence bindings and a single balance throughout the supplied trace.
import {compileRegime} from "./retention.mjs";
import {recordReader} from "./evidence-source.mjs";
import {groupBy,observationPlanner} from "./observation-plan.mjs";
import {evaluate} from "./contract-language.mjs";

const isMap = value=>value!==null && typeof value==="object" && !Array.isArray(value);
function fields(object,keys,label) {
  if(!isMap(object) || !Object.keys(object).every(key=>keys.includes(key))) throw Error("Invalid "+label+" fields.");
}
function unique(list,valid,label) {
  if(!Array.isArray(list) || new Set(list).size!==list.length || !list.every(valid)) throw Error("Invalid "+label+".");
}
const own=(object,key)=>Object.hasOwn(object,key);

export function readSystem(source,system,actor) {
  fields(system,["regime","initial","enabled","roles"],"knowledge system");
  const {edition,rows}=compileRegime(source,system.regime);
  const ids=new Map(rows.map(row=>[row.id,row.index]));
  unique(system.initial,id=>ids.has(id),"initial histories");
  if(!system.initial.length) throw Error("Supply a nonempty initial set.");
  if(!isMap(system.roles) || !own(system.roles,actor)) throw Error("Unknown observer role.");
  const view=system.roles[actor];
  fields(view,["question","observe","offers","budget","signals"],"observer");
  const q=system.regime.questions.indexOf(view.question);
  if(q<0) throw Error("The observer must name a regime question.");
  const fact=name=>typeof name==="string" && edition.bindings.has(name) && rows.every(row=>own(row.facts,name));
  unique(view.observe,fact,"observer fields");
  if(!isMap(view.offers) || Object.keys(view.offers).length>12) throw Error("Invalid observation offers.");
  const grants=new Map();
  for(const [name,offer] of Object.entries(view.offers)) {
    const conditional=isMap(offer);
    if(conditional) fields(offer,["cost","allowedWhen"],"conditional offer");
    const price=conditional?offer.cost:offer;
    if(!fact(name) || view.observe.includes(name) || !Number.isSafeInteger(price) || price<1 || price>1e9 ||
       (conditional && !edition.rules.has(offer.allowedWhen))) throw Error("Invalid offer or grant for "+name);
    if(conditional) for(const key of edition.dependencies.get(offer.allowedWhen).keys())
      if(!fact(key)) throw Error("Missing state field in offer grant: "+key);
    grants.set(name,{price,allowed:rows.map(row=>!conditional || evaluate(edition,offer.allowedWhen,row.facts))});
  }
  if(!Number.isSafeInteger(view.budget) || view.budget<0) throw Error("Invalid observer budget.");
  const actionNames=system.regime.actions;
  if(!isMap(view.signals) || Object.keys(view.signals).length!==actionNames.length ||
      actionNames.some(a=>!own(view.signals,a) || typeof view.signals[a]!=="string" || !view.signals[a].length || view.signals[a].length>80))
    throw Error("Assign exactly one visible signal to every action. Use one shared label for indistinguishable actions.");
  let enabled=system.enabled;
  if(enabled!==undefined) {
    if(!isMap(enabled) || Object.keys(enabled).length!==rows.length || rows.some(row=>!own(enabled,row.id)))
      throw Error("Specify enabled actions for every history, or omit enabled for a total machine.");
    for(const actions of Object.values(enabled)) unique(actions,name=>actionNames.includes(name),"enabled action");
  }
  const moves=rows.map(row=>(enabled?enabled[row.id]:actionNames).map(action=>({
    action, signal:view.signals[action], to:row.successors[actionNames.indexOf(action)]})));
  return {edition,rows,view,q,moves,grants,initial:system.initial.map(id=>ids.get(id)),actor,questions:system.regime.questions};
}

export function observation(row,view) {
  return Object.fromEntries(view.observe.map(f=>[f,row.facts[f]]));
}

// Synchronous perfect recall of the given free fields and signal at every
// action boundary. Reachability in the indistinguishable pair product is exact.
function allHistories({rows,view,q,moves,initial,actor}) {
  const signatures=rows.map(row=>JSON.stringify(observation(row,view)));
  const queue=[],seen=new Set();
  function add(left,right,parent,leftAction,rightAction) {
    if(signatures[left]!==signatures[right]) return;
    const key=left*rows.length+right;
    if(seen.has(key)) return;
    seen.add(key);
    queue.push({left,right,parent,leftAction,rightAction});
  }
  for(const left of initial) for(const right of initial) add(left,right,-1);
  let edges=0;
  for(let i=0;i<queue.length;i++) {
    const pair=queue[i];
    if(rows[pair.left].answers[q]!==rows[pair.right].answers[q]) {
      const path=[];
      for(let k=i;k>=0;k=queue[k].parent) {
        const item=queue[k],a=rows[item.left],b=rows[item.right];
        path.push({left:a.id,right:b.id,observations:observation(a,view),...(item.parent===-1?{}:{
          signal:view.signals[item.leftAction],leftAction:item.leftAction,rightAction:item.rightAction})});
      }
      return {scope:"declared_synchronous_perfect_recall",actor,question:view.question,status:"not_always_known",
        witness:path.reverse(),answers:[rows[pair.left].answers[q],rows[pair.right].answers[q]],pairsExamined:i+1};
    }
    for(const a of moves[pair.left]) for(const b of moves[pair.right]) {
      if(++edges>3000000) throw Error("Observer transition search exceeded 3,000,000 paired edges.");
      if(a.signal===b.signal) add(a.to,b.to,i,a.action,b.action);
    }
  }
  return {scope:"declared_synchronous_perfect_recall",actor,question:view.question,status:"always_known",pairsExamined:queue.length};
}

function applyTrace({edition,rows,view,q,moves,grants,initial,actor},trace) {
  fields(trace,["steps"],"observation trace");
  if(!Array.isArray(trace.steps) || !trace.steps.length || trace.steps.length>256) throw Error("Supply 1–256 chronological observations.");
  let possible=new Map(initial.map(i=>[i,{id:rows[i].id}]));
  let spent=0,subject,lastAt=-Infinity,lastReview=-Infinity;
  const steps=[];
  const base={scope:"supplied_records_within_declared_system",actor,question:view.question};
  for(const [i,step] of trace.steps.entries()) {
    fields(step,i?["signal","packet","buy"]:["packet","buy"],"step");
    const packet=step.packet;
    const read=recordReader(edition,packet);
    if((i && subject!==packet.subject) || packet.at<=lastAt || packet.asOf<lastReview) throw Error("Keep the same subject and chronological events and reviews.");
    subject=packet.subject;lastAt=packet.at;lastReview=packet.asOf;
    if(i) {
      if(!Object.values(view.signals).includes(step.signal)) throw Error("Unknown observer signal.");
      const next=new Map();
      for(const [state,path] of possible) for(const edge of moves[state]) {
        if(edge.signal===step.signal && !next.has(edge.to))
          next.set(edge.to,{id:rows[edge.to].id,parent:path,action:edge.action});
      }
      possible=next;
    }
    const observations=Object.create(null);
    function filter(fact) {
      const value=read(fact);
      if(value===undefined) return false;
      observations[fact]=value;
      for(const state of possible.keys()) if(rows[state].facts[fact]!==value) possible.delete(state);
      return true;
    }
    for(const fact of view.observe) filter(fact);
    const buy=step.buy??[];
    unique(buy,f=>typeof f==="string" && own(view.offers,f),"purchased observation");
    const attempted=[];
    for(const fact of buy) {
      if(!possible.size) break;
      const {price,allowed}=grants.get(fact);
      if(![...possible.keys()].every(id=>allowed[id]))
        return {...base,status:"grant_unresolved",atStep:i,spent,remaining:view.budget-spent,fact,steps,attempted};
      if(view.budget-spent<price)
        return {...base,status:"budget_exhausted",atStep:i,spent,remaining:view.budget-spent,fact,price,steps,attempted};
      spent+=price;
      attempted.push({fact,cost:price,obtained:filter(fact)});
    }
    if(!possible.size) return {...base,status:"inconsistent",atStep:i,spent,remaining:view.budget-spent,observations,attempted,steps};
    const options=[...possible].map(([state,path])=>({...rows[state],path,answer:rows[state].answers[q]}));
    const pathOf=(p)=>{
      const result=[];for(;p;p=p.parent) result.push({id:p.id,...(p.action?{action:p.action}:{})});
      return result.reverse();
    };
    // An observation already attempted in this step cannot serve as a second
    // copy of the same observation. A future step can purchase a fresh reading.
    const offers=[...grants].filter(([name])=>!buy.includes(name)).map(([name,g])=>[name,g.price]);
    const plan=observationPlanner(offers,(fact,subset)=>subset.every(row=>grants.get(fact).allowed[row.index])).plan(options);
    const summary={at:packet.at,possibleStates:options.length,observations,attempted,spent,remaining:view.budget-spent};
    if(!plan.cost) steps.push({...summary,status:"determined",answer:options[0].answer});
    else {
      const a=options[0], b=options.find(row=>row.answer!==a.answer);
      const price=Number.isFinite(plan.cost)?plan.cost:null;
      steps.push({...summary,status:price===null?"unresolved":price>view.budget-spent?"over_budget":"observation_available",
        worstCaseAdditionalCost:price,...(plan.fact?{firstObservation:{fact:plan.fact,...edition.bindings.get(plan.fact),cost:grants.get(plan.fact).price}}:{}),
        witness:[{path:pathOf(a.path),answer:a.answer},{path:pathOf(b.path),answer:b.answer}]});
    }
  }
  return {...base,status:steps.at(-1).status,spent,remaining:view.budget-spent,steps};
}

export function knowledge(source,system,actor,trace) {
  const compiled=readSystem(source,system,actor);
  return trace===undefined?allHistories(compiled):applyTrace(compiled,trace);
}

// Exact worst-case *acquisition* cost for the given finite demand schedule.
// A read strictly reduces its current possible-state set. Answering advances
// the epoch. This lexicographic order makes the cost recurrence acyclic.
// Histories can choose different future events; the observer sees only signals.
export function planKnowledge(source,system,actor,demands) {
  const {edition,rows,view,moves,initial,grants,questions}=readSystem(source,system,actor);
  if(!Array.isArray(demands) || !demands.length || demands.length>32 || demands.some(q=>!questions.includes(q)))
    throw Error("Supply a schedule of 1–32 declared questions.");
  const target=demands.map(q=>questions.indexOf(q));
  const signatures=rows.map(row=>observation(row,view));
  const seen=new Map();
  const allowed=Object.entries(view.offers);
  let edges=0;
  function checkSize(n=1) {
    edges+=n;
    if(edges>1000000 || seen.size>10000) throw Error("Funded planning budget exhausted. No feasibility verdict.");
  }
  function separate(cases,getKey) {
    return [...groupBy(cases,entry=>JSON.stringify(getKey(entry)))].map(([key,entries])=>({
      outcome:JSON.parse(key), states:[...new Set(entries.map(e=>e.to))].sort((a,b)=>a-b)
    }));
  }
  function price(groups,epoch,fixed,bound) {
    let cost=fixed;
    const links=[];
    for(const {outcome,states} of groups) {
      const child=solve(states,epoch);
      cost=Math.max(cost,fixed+child.cost);
      if(cost>=bound || !Number.isFinite(cost)) return {cost:Infinity};
      links.push({outcome,child});
    }
    return {cost,links};
  }
  function solve(states,epoch) {
    const key=epoch+":"+states.join(",");
    if(seen.has(key)) return seen.get(key);
    checkSize();
    let best={cost:Infinity};
    const answer=rows[states[0]].answers[target[epoch]];
    const final=epoch+1===demands.length;
    // Every admitted history owes the complete schedule. A terminal state
    // before the next demand cannot silently remove its branch.
    if(states.every(i=>rows[i].answers[target[epoch]]===answer) && (final || states.every(i=>moves[i].length>0))) {
      const next=[];
      if(epoch+1<demands.length) for(const state of states) {
        checkSize(moves[state].length);
        for(const edge of moves[state]) next.push(edge);
      }
      const groups=separate(next,e=>({signal:e.signal,observe:signatures[e.to]}));
      const result=price(groups,epoch+1,0,Infinity);
      best={...result,op:"answer",answer};
    }
    for(const [fact] of allowed) {
      const {price:fee,allowed:permit}=grants.get(fact);
      if(fee>=best.cost || !states.every(i=>permit[i])) continue;
      checkSize(states.length);
      const groups=separate(states.map(to=>({to})),e=>rows[e.to].facts[fact]);
      if(groups.length<2) continue;
      const result=price(groups,epoch,fee,best.cost);
      if(result.cost<best.cost) best={...result,op:"read",fact,source:edition.bindings.get(fact).source,fee};
    }
    seen.set(key,best);
    return best;
  }
  const start=separate(initial.map(to=>({to})),e=>signatures[e.to]);
  const root=price(start,0,0,Infinity);
  const base={scope:"declared_finite_schedule_and_acquisition_tariff",actor,demands,budget:view.budget,
    observationAssumption:"all declared free fields arrive at each event; purchased values hold for the current state",
    memoizedBeliefs:seen.size,searchEdges:edges};
  if(!Number.isFinite(root.cost)) return {...base,status:"unresolvable",minimumWorstCaseCost:null};
  if(root.cost>view.budget) return {...base,status:"over_budget",minimumWorstCaseCost:root.cost};
  const nodes=[], ids=new Map();
  function encode(node) {
    if(ids.has(node)) return ids.get(node);
    const id=nodes.length;
    ids.set(node,id); nodes.push(null);
    const {links,cost,...operation}=node;
    nodes[id]={...operation,worstCaseRemaining:cost,branches:links.map(({outcome,child})=>({outcome,to:encode(child)}))};
    return id;
  }
  const branches=root.links.map(({outcome,child})=>({observe:outcome,to:encode(child)}));
  return {...base,status:"within_budget",minimumWorstCaseCost:root.cost,initial:branches,policy:nodes};
}
