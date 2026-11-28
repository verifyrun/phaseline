import assert from "node:assert/strict";
import {suggestPrerequisite} from "./index.mjs";
const sample=[{seen:["observed","approved"],acted:true},{seen:["approved"],acted:false},
  {seen:["observed"],acted:false},{seen:[],acted:false}];
const found=suggestPrerequisite(sample);
assert.equal(found.status,"candidate");
assert.deepEqual(found.features,["approved","observed"]);
assert.equal(found.truePositive,1);
assert.equal(found.falsePositive,0);
assert.deepEqual(suggestPrerequisite([...sample].reverse()),found);
const noisy=suggestPrerequisite([...sample,{seen:["observed","approved"],acted:false}]);
assert.equal(noisy.falsePositive,1);
assert.deepEqual(noisy.counterexamples,{presentButWaited:4,absentButActed:null});
const missed=suggestPrerequisite([{seen:["x"],acted:true},{seen:[],acted:true},{seen:[],acted:false}]);
assert.equal(missed.counterexamples.absentButActed,1);
assert.equal("release" in noisy,false);
assert.equal(suggestPrerequisite([{seen:["approved"],acted:true}]).reason,"both_outcomes_required");
assert.equal(suggestPrerequisite([{seen:[],acted:false},{seen:[],acted:true}]).reason,"no_predictive_positive_feature");
assert.equal(suggestPrerequisite([{seen:["a","b"],acted:true},{seen:[],acted:false}]).equalBest,2);
assert.throws(()=>suggestPrerequisite([{seen:["dup","dup"],acted:false}]),/distinct/);
console.log("Trace proposals distinguish a conjunction, counterexamples, equivalent candidates and insufficient evidence.");
assert.throws(()=>suggestPrerequisite([{seen:Array(1),acted:false}]),/distinct/);

import {readFileSync} from "node:fs";
import {decide} from "./index.mjs";
const contract = readFileSync(new URL("./consent-before-action.phase", import.meta.url), "utf8");
const evidence = (subject, source, by, value) => ({subject, at: 1, recorded: 1, source, by, value});
function review(subject, answers) {
  const records = [evidence(subject,"intake.complete","intake",true),evidence(subject,"receiver.offered","receiver",true),...answers];
  return decide(contract,{subject,at:1,asOf:1,records}).submit;
}
const yes = evidence("recipient-A/offer-v1","customer.accepted","customer",true);
assert.equal(review(yes.subject,[yes]).status,"release");
assert.deepEqual(review("recipient-A/offer-v2",[yes]).needs.map(n=>n.fact),["accepted"]);
assert.equal(review("recipient-B/offer-v1",[yes]).status,"hold");
assert.equal(review(yes.subject,[{...yes,value:false}]).status,"withhold");
assert.equal(review(yes.subject,[{...yes,by:"assistant"}]).status,"hold");
