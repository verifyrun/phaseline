import assert from "node:assert/strict";
import {planControl} from "./control.mjs";

const source = [
  "fact done from receipt.applied owner publisher",
  "fact duplicate from receipt.repeated owner publisher",
  "fact permitted from grant.active owner owner",
  "guarantee delivered when done",
  "guarantee safe when not duplicate",
  "guarantee authorized when permitted"
].join("\n");
const task = {goal:"delivered",safe:"safe",commands:{deliver:{cost:3,effects:["submit"],requires:"authorized"}}};

function situation({deduplicate=false, inspect=false, budget=9, fault=false}={}) {
  const states=["pending","delivered","duplicate"].map((id,i)=>({id,
    facts:{done:i>0,duplicate:i===2,permitted:true},
    next:{submit:i===0||deduplicate?"delivered":"duplicate",lost:id}}));
  const regime={questions:["delivered","safe","authorized"], actions:["submit","lost"], observe:[], offers:{}, budget:0, states};
  const role={question:"delivered", observe:[], offers:inspect?{done:2}:{}, budget,
              signals:{submit:"return",lost:"return"}};
  const system={initial:["pending","delivered"], roles:{peer:role},regime};
  const request=structuredClone(task);
  if(fault) request.commands.deliver.effects.push("lost");
  return {system,request};
}
function run(x) { return planControl(source,x.system,"peer",x.request); }
const blind=run(situation());
assert.equal(blind.status,"unachievable");
assert.ok(blind.obstruction.beliefs[0].blocked.some(x=>x.reason==="possible unsafe effect"));
const purchased=run(situation({inspect:true}));
assert.equal(purchased.minimumWorstCaseCost,5);
assert.deepEqual(purchased.policy.nodes[0].operation,{read:"done",source:"receipt.applied"});
assert.equal(run(situation({inspect:true,budget:4})).status,"over_budget");
const dedup=run(situation({deduplicate:true,inspect:true}));
assert.equal(dedup.minimumWorstCaseCost,3);
assert.deepEqual(dedup.policy.nodes[0].operation,{command:"deliver"});
assert.equal(run(situation({deduplicate:true,inspect:true,fault:true})).status,"unachievable");
const prior=situation();prior.system.initial=["delivered"];prior.system.roles.peer.budget=0;
assert.equal(run(prior).minimumWorstCaseCost,0);
const unsafe=situation();unsafe.system.initial=["duplicate"];
assert.equal(run(unsafe).status,"unachievable");
const denied=situation({inspect:true});denied.system.regime.states[0].facts.permitted=false;
assert.equal(run(denied).status,"unachievable");
const inv=situation();inv.request.commands.deliver.cost=0;
assert.throws(()=>run(inv),/Invalid command/);
const unread=situation({inspect:true});
unread.system.roles.peer.offers.done={cost:2,allowedWhen:"authorized"};
unread.system.regime.states[1].facts.permitted=false;
assert.equal(run(unread).status,"unachievable");
const observed=situation();observed.system.roles.peer.observe=["done"];
assert.equal(run(observed).minimumWorstCaseCost,3);
const settled=situation({inspect:true});settled.request.goal="safe";settled.request.settle=["delivered"];
assert.equal(run(settled).minimumWorstCaseCost,2);
const forever=situation({deduplicate:true,fault:true});forever.system.initial=["pending"];
assert.ok(run(forever).obstruction.beliefs.some(x=>x.counterOutcomes.length));
console.log("14 strong-control regressions passed, including indistinguishable commits, paid reads and adversarial cycles.");
