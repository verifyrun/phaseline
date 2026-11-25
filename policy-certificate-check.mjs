import assert from "node:assert/strict";
import {certifyPolicy} from "./policy-certificate.mjs";

const atom=[0,1], branch=(signal,next)=>({signal,next});
const finish={finish:true};
const act=(outcomes,observe=[],cost=3)=>({name:"act",cost,requires:true,outcomes,observe});
const write=v=>({when:true,write:[0,v]});
const source=(commands,rest={})=>({format:"factored-control/1",variables:[2],initial:true,goal:atom,safe:true,commands,...rest});
const policy=(...nodes)=>({initial:0,nodes});
const jump=(...branches)=>({command:"act",branches});
const a=source([act([[write(1)]],[atom])]);
const p=policy(jump(branch("1",1)),finish);
assert.equal(certifyPolicy(a,p).worstExecutionCost,3);
assert.equal(certifyPolicy(a,p,{budget:2}).status,"over_budget");
assert.equal(certifyPolicy(a,p,{workLimit:1}).status,"hold");
assert.equal(certifyPolicy({...a,initial:false},p).status,"hold");
assert.equal(certifyPolicy({...a,safe:atom},p).status,"invalid_policy");
assert.equal(certifyPolicy({...a,goal:false},p).status,"invalid_policy");
assert.equal(certifyPolicy(a,policy(jump(),finish)).witness.missing.signal,"1");
const loop=source([act([[],[write(1)]],[atom],0)],{initial:[0,0]});
assert.equal(certifyPolicy(loop,policy(jump(branch("0",0),branch("1",1)),finish)).witness.repeatFrom,0);
assert.equal(certifyPolicy(source([act([[write(0),write(1)]])]),policy(jump(branch("",1)),finish)).status,"hold");
assert.throws(()=>certifyPolicy(a,policy({...p.nodes[0],readWorld:0},finish)));
assert.throws(()=>certifyPolicy(a,policy(jump(branch("1",0),branch("1",1)),finish)));
assert.equal(certifyPolicy(source([{...a.commands[0],requires:atom}]),p).status,"invalid_policy");
const simultaneous=source([{name:"swap",cost:2,requires:true,observe:[],outcomes:[[
  {when:[1,1],write:[0,1]},{when:[0,0],write:[1,0]}
]]}],{variables:[2,2],initial:{all:[[0,0],[1,1]]},goal:{all:[[0,1],[1,0]]}});
assert.equal(certifyPolicy(simultaneous,policy({command:"swap",branches:[branch("",1)]},finish)).worstExecutionCost,2);

// Independent finite reference. Start with valid terminal pairs. A pair can enter a
// later round only when every successor already has a finite termination cost.
function unfold(problem,proposal) {
  const worlds=[0,1];
  const evaluate=(f,w)=>typeof f==="boolean"?f:Array.isArray(f)?w===f[1]:
    f.not!==undefined?!evaluate(f.not,w):f.one.filter(c=>evaluate(c,w)).length===1;
  const value=new Map();
  let changed=true;
  while(changed){
    changed=false;
    for (const [i,n] of proposal.nodes.entries()) for(const w of worlds) {
      const k=2*i+w;
      if(value.has(k)||!evaluate(problem.safe,w))continue;
      let price=0;
      if(n.finish){if(!evaluate(problem.goal,w))continue;}
      else {
        const c=problem.commands[0];
        if(!evaluate(c.requires,w))continue;
        const costs=c.outcomes.map(effects=>{
          const effect=effects.find(e=>evaluate(e.when,w));
          const u=effect?effect.write[1]:w;
          const signal=c.observe.map(a=>String(Number(evaluate(a,u)))).join("");
          const next=n.branches.find(b=>b.signal===signal);
          return next?value.get(2*next.next+u):undefined;
        });
        if(costs.some(cost=>cost===undefined))continue;
        price=c.cost+Math.max(...costs);
      }
      value.set(k,price);changed=true;
    }
  }
  const beginnings=worlds.filter(w=>evaluate(problem.initial,w));
  if(!beginnings.length)return ["hold",null];
  const values=beginnings.map(w=>value.get(2*proposal.initial+w));
  return values.includes(undefined)?["invalid_policy",null]:["certified_policy",Math.max(...values)];
}
let seed=8147;
const pick=xs=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return xs[Math.floor(seed/4294967296*xs.length)];};
const fs=[true,true,true,false,[0,0],atom,{not:atom},{one:[true,atom]}];
const totals={};
for(let i=0;i<1500;i++){
  const observe=pick([[],[atom]]);
  const outcomes=Array.from({length:pick([1,1,2,3])},()=>pick([[],[{when:pick(fs),write:[0,pick([0,1])]}]]));
  const c={...act(outcomes,observe,pick([0,1,3,13])),requires:pick(fs)};
  const m=source([c],{initial:pick(fs),goal:pick(fs),safe:pick(fs)});
  const n=pick([1,2,3,4]);
  const nodes=Array.from({length:n},()=>pick([false,false,true])?finish:
    jump(...(observe.length?["0","1"]:[""]).filter(()=>pick([true,true,true,false])).map(s=>branch(s,pick([...Array(n).keys()])))));
  const candidate=policy(...nodes), got=certifyPolicy(m,candidate), expected=unfold(m,candidate);
  assert.deepEqual([got.status,got.worstExecutionCost??null],expected);
  const padded={...m,variables:[...m.variables,5,7]};
  const smaller=certifyPolicy(padded,candidate,{project:true});
  assert.deepEqual([smaller.status,smaller.worstExecutionCost??null],expected);
  if(smaller.status==="certified_policy")assert.equal(BigInt(smaller.originalInitialWorldsCovered)%35n,0n);
  totals[got.status]=(totals[got.status]??0)+1;
}
console.log(JSON.stringify({checkedControllers:1500,results:totals}));

const veryWide={...a,variables:Array(193).fill(2)};
const lifted=certifyPolicy(veryWide,p,{project:true,workLimit:5000});
assert.equal(lifted.originalInitialWorldsCovered,String(1n<<193n));
assert.equal(lifted.worstExecutionCost,3);
assert.equal(certifyPolicy(veryWide,p,{workLimit:5000}).status,"hold");
assert.equal(certifyPolicy({...veryWide,initial:{all:[atom,{not:[192,0]}]}},p,{project:true}).originalInitialWorldsCovered,String(1n<<191n));
const badWorld={...veryWide,safe:{not:[192,1]}};
assert.equal(certifyPolicy(badWorld,p,{project:true}).status,"invalid_policy");
const latent=source([act([[{when:[1,1],write:[0,1]}]],[atom])],{variables:[2,2]});
assert.equal(certifyPolicy(latent,p,{project:true}).status,"invalid_policy");
const conflicting=source([act([[write(1),{when:true,write:[1,0]},{when:true,write:[1,1]}]],[atom])],{variables:[2,2]});
assert.equal(certifyPolicy(conflicting,p,{project:true}).status,"hold");
