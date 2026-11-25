// Compare what a caller can observe when each edition has its own remaining wallet.
import {canonical} from "./carry.mjs";
import {readMachine} from "./machine-comparison.mjs";

const MAX_PAIRS=200000, MAX_STEPS=2000000;
const min=(x,y)=>x<y?x:y;
function unknown(machine,state,input) {
  return machine.model.missing==="unobserved" && machine.inputs.has(input) && !machine.table[state].has(input);
}
function step(machine,state,balance,input) {
  const edge=machine.table[state].get(input);
  if (!edge) return {state,balance,reply:{status:"unavailable"},key:"unavailable"};
  if (balance<edge.work) return {state,balance:machine.model.onExhaustion==="keep"?balance:0n,
      reply:{status:"exhausted"},key:"exhausted"};
  return {state:edge.to,balance:balance-edge.work,reply:{status:"completed",value:edge.out},key:"value:"+edge.key};
}
function word(node,tail=[]) {
  const path=[];
  for (;node?.parent;node=node.parent) path.push(node.action);
  return path.reverse().concat(tail);
}
function witness(a,b,amount,actions) {
  let left={state:a.start,balance:amount},right={state:b.start,balance:amount};
  for (const input of actions) {
    if (unknown(a,left.state,input)||unknown(b,right.state,input)) throw Error("Witness crosses missing evidence.");
    left=step(a,left.state,left.balance,input);
    right=step(b,right.state,right.balance,input);
  }
  if (left.key===right.key) throw Error("Proposed wallet failed to produce an observable difference.");
  return {openingBalance:String(amount),actions,issued:left.reply,proposed:right.reply,
    remaining:{issued:String(left.balance),proposed:String(right.balance)}};
}
function fixed(a,b,inputs,amount,limit) {
  const queue=[{l:a.start,r:b.start,x:amount,y:amount,parent:null}];
  const key=(l,r,x,y)=>[l,r,x,y].join("/");
  const seen=new Set([key(a.start,b.start,amount,amount)]);
  let examined=0, gap=null;
  const report=(status,more)=>({status,openingBalance:String(amount),pairsReached:seen.size,inputsExamined:examined,...more});
  for(let i=0;i<queue.length;i++) {
    const at=queue[i];
    for(const input of inputs) {
      if(examined>=limit.steps) return report("hold",{reason:"transition work limit",firstUnknown:gap});
      examined++;
      if(unknown(a,at.l,input)||unknown(b,at.r,input)) {
        gap??={actions:word(at,[input])};
        continue;
      }
      const l=step(a,at.l,at.x,input),r=step(b,at.r,at.y,input);
      if(l.key!==r.key) return report("changed",{witness:witness(a,b,amount,word(at,[input]))});
      const tag=key(l.state,r.state,l.balance,r.balance);
      if(!seen.has(tag)) {
        if(seen.size>=limit.pairs) return report("hold",{reason:"reachable pair limit",firstUnknown:gap});
        seen.add(tag);
        queue.push({l:l.state,r:r.state,x:l.balance,y:r.balance,parent:at,action:input});
      }
    }
  }
  if(gap) return report("hold",{reason:"reachable behavior is unobserved",firstUnknown:gap});
  return report("equivalent",{scope:"all finite action sequences at this exact opening balance"});
}

// Dijkstra visits pairs in increasing cost of a common, fully funded prefix.
export class CostFrontier {
  nodes=[];
  push(node) {
    let i=this.nodes.length;
    this.nodes.push(node);
    while(i>0) {
      const j=Math.floor((i-1)/2);
      if(this.nodes[j].cost<=node.cost) break;
      this.nodes[i]=this.nodes[j];i=j;
    }
    this.nodes[i]=node;
  }
  pop() {
    const result=this.nodes[0],last=this.nodes.pop(),n=this.nodes.length;
    if(n>0) {
      let i=0;
      while(2*i+1<n) {
        let j=2*i+1;
        if(j+1<n && this.nodes[j+1].cost<this.nodes[j].cost) j++;
        if(last.cost<=this.nodes[j].cost) break;
        this.nodes[i]=this.nodes[j];i=j;
      }
      this.nodes[i]=last;
    }
    return result;
  }
}
function least(a,b,inputs,limit,initialGap) {
  const frontier=new CostFrontier(), distances=new Map();
  const key=(l,r)=>l*b.table.length+r;
  const initial={l:a.start,r:b.start,cost:0n,parent:null};
  distances.set(key(initial.l,initial.r),0n);frontier.push(initial);
  let examined=0,best=null,missing=initialGap?{cost:0n,actions:[],missing:"reset output"}:null;
  const costChoice=a.model.onExhaustion!==b.model.onExhaustion;
  const keepLeft=a.model.onExhaustion==="keep";
  const report=(status,more)=>({status,openingBalance:"any",pairsReached:distances.size,inputsExamined:examined,...more});
  function record(at,tail,extra) {
    const cost=at.cost+extra;
    if (!best || cost<best.cost) best={at,tail,cost};
  }
  function result(reason) {
    const known=best?witness(a,b,best.cost,word(best.at,best.tail)):null;
    const firstUnknown=missing?{openingBalanceLowerBound:String(missing.cost),actions:missing.actions}:null;
    if(reason || (missing && (!best || missing.cost<best.cost))) return report("hold",{
      reason:reason??"unobserved behavior may change the minimum",firstUnknown,knownWitness:known});
    if(best) return report("changed",{minimumOpeningBalance:String(best.cost),witness:known});
    return report("equivalent",{scope:"all finite action sequences at every nonnegative integer opening balance"});
  }
  while(frontier.nodes.length) {
    const at=frontier.pop();
    if(distances.get(key(at.l,at.r))!==at.cost) continue;
    if(best && at.cost>=best.cost) break;
    const cheap=costChoice?(keepLeft?a.cheapest[at.l]:b.cheapest[at.r]):null;
    for(const input of inputs) {
      if(examined>=limit.steps) return result("transition work limit");
      examined++;
      if(unknown(a,at.l,input)||unknown(b,at.r,input)) {
        if(!missing || at.cost<missing.cost) missing={cost:at.cost,actions:word(at,[input])};
        continue;
      }
      const l=a.table[at.l].get(input),r=b.table[at.r].get(input);
      if(!l||!r) {
        if(Boolean(l)!==Boolean(r)) record(at,[input],0n);
        continue;
      }
      const lesser=min(l.work,r.work);
      // A failed common action can leave different private funds. Before either
      // machine moves again, the keeping side must be able to pay for an action.
      if(cheap && cheap.work<lesser && !unknown(keepLeft?b:a,keepLeft?at.r:at.l,cheap.input))
        record(at,[input,cheap.input],cheap.work);
      if(l.work!==r.work || l.key!==r.key) {
        record(at,[input],lesser);
        continue;
      }
      const cost=at.cost+l.work,tag=key(l.to,r.to),prev=distances.get(tag);
      if((best && cost>=best.cost) || (prev!==undefined && prev<=cost)) continue;
      if(prev===undefined && distances.size>=limit.pairs) return result("reachable pair limit");
      distances.set(tag,cost);frontier.push({l:l.to,r:r.to,cost,parent:at,action:input});
    }
  }
  return result(null);
}

export function comparePricedMachines(issued,proposed,wallet="any",{maxPairs=MAX_PAIRS,maxSteps=MAX_STEPS}={}) {
  if(typeof wallet!=="string" || (wallet!=="any" && !/^(0|[1-9][0-9]{0,127})$/.test(wallet)))
    throw Error("Supply any or one exact nonnegative opening balance.");
  if(!Number.isSafeInteger(maxPairs) || maxPairs<1 || maxPairs>MAX_PAIRS ||
     !Number.isSafeInteger(maxSteps) || maxSteps<1 || maxSteps>MAX_STEPS) throw Error("Invalid finite comparison work limit.");
  const a=readMachine(issued,true),b=readMachine(proposed,true), inputs=[...new Set([...a.inputs,...b.inputs])].sort();
  const l=Object.hasOwn(issued,"initialReply"),r=Object.hasOwn(proposed,"initialReply");
  if(l && r && JSON.stringify(canonical(issued.initialReply))!==JSON.stringify(canonical(proposed.initialReply))) {
    const sum=wallet==="any"?"0":wallet;
    return {status:"changed",openingBalance:wallet,...(wallet==="any"?{minimumOpeningBalance:"0"}:{}),
      witness:{openingBalance:sum,actions:[],issued:issued.initialReply,proposed:proposed.initialReply}};
  }
  const limits={pairs:maxPairs,steps:maxSteps};
  if(wallet==="any") return least(a,b,inputs,limits,l!==r);
  const balance=BigInt(wallet), productStates=a.table.length*b.table.length;
  let precheck=null;
  // A large exact wallet can induce billions of balance states even for two identical loops.
  // Reserve at most half the input budget for a complete balance-independent proof first.
  if (balance>BigInt(productStates) && productStates<=maxPairs && productStates*inputs.length<=Math.floor(maxSteps/2)) {
    precheck=least(a,b,inputs,limits,l!==r);
    if(precheck.status==="equivalent" ||
        (precheck.status==="changed" && balance<BigInt(precheck.minimumOpeningBalance)))
      return {status:"equivalent",openingBalance:wallet,pairsReached:precheck.pairsReached,inputsExamined:precheck.inputsExamined,
        certifiedBy:precheck.status==="equivalent"?"all-wallet equivalence":"below the first separating wallet",
        scope:"all finite action sequences at this exact opening balance"};
    limits.steps-=precheck.inputsExamined;
  }
  const outcome=fixed(a,b,inputs,balance,limits);
  if(precheck) {
    outcome.precheck={pairsReached:precheck.pairsReached,inputsExamined:precheck.inputsExamined};
    outcome.inputsExamined+=precheck.inputsExamined;
  }
  if(l!==r && outcome.status==="equivalent") return {...outcome,status:"hold",reason:"reset output unobserved",scope:undefined};
  return outcome;
}
