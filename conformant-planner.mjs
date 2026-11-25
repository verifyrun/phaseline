// A backward search can construct an observation-independent plan directly from
// the original goal. The independent physical verifier checks the returned policy.
import {DecisionDiagram} from "./decision-diagram.mjs";
import {CostFrontier} from "./priced-machines.mjs";
import {physicalFormula} from "./factored-origins.mjs";
import {certifyPolicy, PhysicalInputLimit, sourceModel} from "./policy-certificate.mjs";

class Limit extends Error {}

function predecessorCompiler(diagram, compile, safe, pay) {
  const literals=new Map();
  function literal(i,value) {
    const key=i+"/"+value;
    if (!literals.has(key)) literals.set(key,compile([i,value]));
    return literals.get(key);
  }
  function cases(i,children) {
    let result=children.at(-1);
    for(let v=children.length-2;v>=0;v--) {
      pay();
      if(children[v]!==result)result=diagram.ite(literal(i,v),children[v],result);
    }
    return result;
  }
  function assignment(effects, permitted) {
    const writes=new Map(),memo=new Map([[0,0],[1,1]]);
    for(const e of effects) {
      pay();
      const [i,value]=e.write, guard=compile(e.when);
      if(!guard)continue;
      if(!writes.has(i))writes.set(i,new Map());
      const at=writes.get(i);
      for(const [other,condition] of at) {
        pay();
        if(other!==value && diagram.and(permitted,diagram.and(condition,guard)))
          throw new Limit("source admits conflicting simultaneous writes");
      }
      at.set(value,diagram.or(at.get(value)??0,guard));
    }
    function apply(region) {
      pay();
      if(memo.has(region))return memo.get(region);
      const n=diagram.nodes[region];
      const children=n.branches.map(apply);
      const updates=writes.get(n.level);
      let result=children.every((v,j)=>v===n.branches[j])?region:cases(n.level,children);
      if(updates)for(const [value,guard] of updates){
        pay();result=diagram.ite(guard,children[value],result);
      }
      memo.set(region,result);return result;
    }
    return apply;
  }
  return function compileCommand(command) {
    const permitted=diagram.and(safe,compile(command.requires));
    const outcomes=command.outcomes.map(e=>assignment(e,permitted));
    return region=>{
      let before=permitted;
      for(const apply of outcomes){
        pay();
        if(!before)break;
        before=diagram.and(before,apply(region));
      }
      return before;
    };
  };
}

function policyFor(at,pay) {
  const nodes=[];
  while(at.next) {
    const n=at.action.observe.length;
    if(n>18)throw new Limit("explicit observation routes exceed construction allowance");
    const count=2**n;
    pay(1+count*(n+1));
    const next=nodes.length+1;
    const branches=Array.from({length:count},(_,v)=>({signal:n?v.toString(2).padStart(n,"0"):"",next}));
    nodes.push({command:at.action.name,branches});
    at=at.next;
  }
  nodes.push({finish:true});
  return {initial:0,nodes};
}

export function constructSequence(model,terms={}) {
  if(!terms || Array.isArray(terms) || typeof terms!=="object" ||
     Object.keys(terms).some(k=>!["workLimit","budget","regionLimit"].includes(k)))throw Error("Invalid sequence terms.");
  const workLimit=terms.workLimit??5000000,budget=terms.budget??Number.MAX_SAFE_INTEGER,regionLimit=terms.regionLimit??20000;
  if(!Number.isSafeInteger(workLimit)||workLimit<1||workLimit>200000000||!Number.isSafeInteger(budget)||budget<0||
     !Number.isSafeInteger(regionLimit)||regionLimit<1||regionLimit>100000)throw Error("Invalid sequence allowance.");
  let used=0,visited=0,cap=Math.floor(workLimit*.75),workBeforeVerification=null;
  const counters={nodes:0,edges:0,calls:0};
  function pay(n=1){if(n>cap-used)throw new Limit("sequence construction work allowance exhausted");used+=n;}
  const stats=()=>({constructionWork:workBeforeVerification??used,visitedRegions:visited,diagramNodes:counters.nodes});
  try {
    const actions=[...sourceModel(model,pay).values()];
    const diagram=new DecisionDiagram(model.variables,counters,pay),compile=physicalFormula(diagram,pay);
    const origins=compile(model.initial),safe=compile(model.safe),goal=diagram.and(safe,compile(model.goal));
    if(!origins)return {status:"hold",reason:"source declares no possible initial state",...stats()};
    const compileCommand=predecessorCompiler(diagram,compile,safe,pay),operators=new Map();
    const heap=new CostFrontier(),best=new Map([[goal,0]]);
    heap.push({region:goal,cost:0,next:null});
    while(heap.nodes.length) {
      pay(1+Math.ceil(Math.log2(1+heap.nodes.length)));
      const at=heap.pop();
      if(best.get(at.region)!==at.cost)continue;
      visited++;
      if(!diagram.and(origins,diagram.not(at.region))) {
        // At this point Dijkstra has settled its minimum among uniform sequences.
        // A signal-dependent plan can still be cheaper or be the only affordable plan.
        if(at.cost>budget)return {status:"hold",reason:"minimum uniform sequence exceeds the execution budget",minimumSequenceCost:at.cost,...stats()};
        cap=workLimit;
        const policy=policyFor(at,pay);
        workBeforeVerification=used;
        if(workLimit===used)throw new Limit("no work remains for independent verification");
        const checked=certifyPolicy(model,policy,{workLimit:workLimit-used,budget,origins:"constraints",project:true});
        if(checked.status==="hold")return {status:"hold",reason:"independent verification: "+checked.reason,
          ...stats(),verificationWork:checked.verificationWork};
        if(checked.status!=="certified_policy"||checked.worstExecutionCost!==at.cost)
          throw Error("Sequence construction disagrees with physical verification.");
        return {status:"certified_policy",minimumSequenceCost:at.cost,worstExecutionCost:checked.worstExecutionCost,
          ...stats(),verificationWork:checked.verificationWork,policy,scope:"minimum cost among strong observation-independent sequences on the supplied physical source"};
      }
      for(const command of actions) {
        pay();
        if(!operators.has(command))operators.set(command,compileCommand(command));
        const before=operators.get(command)(at.region);
        if(!before)continue;
        const cost=at.cost+command.cost;
        if(!Number.isSafeInteger(cost))throw new Limit("sequence cost exceeds the supported integer range");
        if((best.get(before)??Infinity)<=cost)continue;
        if(!best.has(before)&&best.size>=regionLimit)throw new Limit("symbolic sequence region limit reached");
        best.set(before,cost);
        pay(1+Math.ceil(Math.log2(2+heap.nodes.length)));
        heap.push({region:before,cost,action:command,next:at});
      }
    }
    return {status:"hold",reason:"no observation-independent sequence meets the goal",sequenceStatus:"unachievable",...stats()};
  } catch(e) {
    if(e instanceof Limit||e instanceof PhysicalInputLimit||/^Symbolic (state|operation) budget exhausted/.test(e.message))
      return {status:"hold",reason:e.message,...stats()};
    throw e;
  }
}
