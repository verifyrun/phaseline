// Synthesize from a finite physical interface without inspecting another planner's policy.
import {sourceModel,truth,certifyPolicy,PhysicalInputLimit} from "./policy-certificate.mjs";
import {clauseOrigins} from "./clause-origins.mjs";
import {symbolicOrigins} from "./factored-origins.mjs";
import {settleValues,checkValues} from "./control.mjs";

class Cut extends Error {}
const isInt=(x,min,max)=>Number.isSafeInteger(x) && x>=min && x<=max;
const interrupted=e=>e instanceof Cut || e instanceof PhysicalInputLimit || /^Symbolic (state|operation) budget exhausted/.test(e.message);
function construction(model,terms,pay) {
  const commands=[...sourceModel(model,pay).values()], worlds=[],worldIndex=new Map(),nodes=[],beliefIndex=new Map();
  let transitions=0,cut=null,origins;
  function world(values){
    pay(1+values.length);
    const key=values.join(","),known=worldIndex.get(key);
    if(known!==undefined)return known;
    if(worlds.length>=terms.worldLimit)throw new Cut("physical state limit reached");
    const i=worlds.length;
    worlds.push({values,safe:truth(model.safe,values,pay),goal:truth(model.goal,values,pay),moves:new Map()});
    worldIndex.set(key,i);return i;
  }
  function belief(input) {
    pay(1+input.length);
    const states=[...new Set(input)].sort((a,b)=>a-b),key=states.join(","),known=beliefIndex.get(key);
    if(known!==undefined)return known;
    if(nodes.length>=terms.beliefLimit)throw new Cut("belief limit reached");
    const i=nodes.length,node={states,parents:[],choices:[],value:Infinity};
    if(states.every(v=>worlds[v].safe && worlds[v].goal))node.answer=true;
    nodes.push(node);beliefIndex.set(key,i);return i;
  }
  const initial=[];
  function start(v){initial.push(world(v));}
  origins=clauseOrigins(model,null,pay,start)??{method:"decision_diagram",...symbolicOrigins(model,null,pay,start)};
  if(!initial.length)return {empty:true};
  const root=belief(initial);
  function moves(state,index) {
    pay();
    const w=worlds[state],c=commands[index];
    if(w.moves.has(index))return w.moves.get(index);
    let result=null;
    if(truth(c.requires,w.values,pay)) {
      result=[];
      for(const effects of c.outcomes) {
        pay(1+w.values.length);
        const next=w.values.slice(),written=new Map();
        for(const e of effects)if(truth(e.when,w.values,pay)){
          const [i,v]=e.write;
          if(written.has(i) && written.get(i)!==v)throw new Cut("undefined conflicting simultaneous writes");
          written.set(i,v);next[i]=v;
        }
        const to=world(next);transitions++;
        if(!worlds[to].safe) {result=null;break;}
        pay(c.observe.length);
        result.push([c.observe.map(([k,v])=>next[k]===v?"1":"0").join(""),to]);
      }
    }
    w.moves.set(index,result);return result;
  }
  function edges(node,index){
    const results=new Map();
    for(const state of node.states) {
      const changes=moves(state,index);
      if(!changes)return null;
      for(const [signal,to] of changes) {
        pay();
        if(!results.has(signal))results.set(signal,[]);
        results.get(signal).push(to);
      }
    }
    return results;
  }
  try {
    for(let i=0;i<nodes.length;i++) {
      const n=nodes[i];
      if(n.answer!==undefined || !n.states.every(s=>worlds[s].safe))continue;
      for(const [j,c] of commands.entries()) {
        pay();
        const partition=edges(n,j);if(!partition)continue;
        const responses=[...partition].map(([signal,indices])=>({signal,to:belief(indices)}));
        if(responses.some(r=>r.to===i))continue; // A strong winning solution never needs this self-returning choice.
        const children=new Set(responses.map(r=>r.to));
        const option={op:c.name,parent:i,cost:c.cost,responses,pending:children.size,worst:0};
        n.choices.push(option);
        for(const child of children)nodes[child].parents.push(option);
      }
    }
  } catch(e) {
    if(!interrupted(e))throw e;
    cut=e.message;
  }
  return {nodes,root,cut,scope:{sourceCommands:commands.length,generatedWorlds:worlds.length,visitedBeliefs:nodes.length,
    originCount:initial.length,evaluatedPhysicalOutcomes:transitions,originMethod:origins.method}};
}

export function constructPhysical(model,terms={}) {
  const workLimit=terms.workLimit??5000000,budget=terms.budget??Number.MAX_SAFE_INTEGER;
  const worldLimit=terms.worldLimit??12000,beliefLimit=terms.beliefLimit??12000;
  if(!terms || Object.keys(terms).some(k=>!["workLimit","budget","worldLimit","beliefLimit"].includes(k)) ||
     !isInt(workLimit,1,200000000)||!isInt(budget,0,Number.MAX_SAFE_INTEGER)||
     !isInt(worldLimit,1,100000)||!isInt(beliefLimit,1,100000))throw Error("Invalid finite physical planning terms.");
  let work=0,cap=Math.floor(workLimit*.70);
  function pay(n=1){if(n>cap-work)throw new Cut("construction work allowance exhausted");work+=n;}
  let graph;
  try {
    graph=construction(model,{worldLimit,beliefLimit},pay);
    if(graph.empty)return {status:"hold",reason:"source declares no possible initial state",constructionWork:work};
    cap=Math.floor(workLimit*.88);
    settleValues(graph.nodes,pay);
    checkValues(graph.nodes,pay);
    const root=graph.nodes[graph.root],common={...graph.scope,fullyExpanded:graph.cut===null};
    if(!Number.isFinite(root.value))return {status:graph.cut?"hold":"unachievable",reason:graph.cut??"the complete finite belief graph has no strongly terminating strategy",
      ...common,constructionWork:work};
    const queue=[graph.root],ids=new Map([[graph.root,0]]),nodes=[];
    for(const i of queue) {
      pay();const n=graph.nodes[i];
      if(n.answer!==undefined){nodes.push({finish:true});continue;}
      const c=n.choice,branches=[];
      for(const r of c.responses) {
        pay();if(!ids.has(r.to)){ids.set(r.to,queue.length);queue.push(r.to);}
        branches.push({signal:r.signal,next:ids.get(r.to)});
      }
      nodes.push({command:c.op,branches});
    }
    const policy={initial:0,nodes};
    const checked=certifyPolicy(model,policy,{workLimit:Math.max(1,workLimit-work),origins:"constraints",project:true});
    if(checked.status==="hold")return {status:"hold",reason:"constructed policy still needs independent verification: "+checked.reason,
      ...common,constructionWork:work,verificationWork:checked.verificationWork};
    if(checked.status!=="certified_policy" || checked.worstExecutionCost!==root.value)throw Error("Constructed policy disagrees with independent physical verification.");
    const cost=checked.worstExecutionCost,stats={...common,constructionWork:work,verificationWork:checked.verificationWork,worstExecutionCost:cost};
    if(cost>budget && graph.cut)return {status:"hold",reason:"found a policy above budget before exhausting alternative choices",...stats};
    if(cost>budget)return {status:"over_budget",minimumWorstCaseCost:cost,...stats};
    return {status:"certified_policy",...(graph.cut?{searchCut:graph.cut}:{minimumWorstCaseCost:cost}),...stats,policy,
      scope:"all declared origins and adverse outcomes, controller synthesized from the physical source"};
  } catch(e) {
    if(!interrupted(e))throw e;
    return {status:"hold",reason:e.message,constructionWork:work,...graph?.scope};
  }
}
