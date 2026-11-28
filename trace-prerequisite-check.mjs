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
assert.equal("release" in noisy,false);
assert.equal(suggestPrerequisite([{seen:["approved"],acted:true}]).reason,"both_outcomes_required");
assert.equal(suggestPrerequisite([{seen:[],acted:false},{seen:[],acted:true}]).reason,"no_predictive_positive_feature");
assert.equal(suggestPrerequisite([{seen:["a","b"],acted:true},{seen:[],acted:false}]).equalBest,2);
assert.throws(()=>suggestPrerequisite([{seen:["dup","dup"],acted:false}]),/distinct/);
console.log("Trace proposals distinguish a conjunction, counterexamples, equivalent candidates and insufficient evidence.");
assert.throws(()=>suggestPrerequisite([{seen:Array(1),acted:false}]),/distinct/);
