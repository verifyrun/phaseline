import assert from "node:assert/strict";
import {traceProducer} from "./index.mjs";

const binding={run:"save-2",release:"v2",subject:"order.ts"};
const event={...binding,steps:2,before:"before",after:"symptom"};
const source={...binding,step:2,tool:"formatter",installation:"workspace@3"};
const before={...binding,step:1,output:"before"};
const trace=(receipts,target=event)=>traceProducer(target,receipts,text=>text.includes("symptom"));
assert.deepEqual(trace([source]),{status:"ask",step:1,field:"output"});
for (const other of [{release:"v1"},{run:"save-1"},{subject:"another.ts"}]) {
  assert.equal(trace([before,{...source,...other}]).field,"tool");
}
assert.deepEqual(trace([before,{...binding,step:2,tool:"formatter"}]),{status:"ask",step:2,field:"installation",tool:"formatter"});
assert.deepEqual(trace([before,source,source]),{status:"traced",step:2,tool:"formatter",installation:"workspace@3"});
assert.equal(trace([before,source,{...source,installation:"system@3"}]).status,"hold");
assert.equal(trace([{...source,output:"other"}]).status,"hold");
assert.equal(trace([{...before,output:"symptom"}],{...event,before:"symptom"}).status,"preexisting");
assert.equal(trace([],{...event,after:"fine"}).status,"absent");
assert.deepEqual(trace([before,source],{...event,before:"symptom"}),{status:"traced",step:2,tool:"formatter",installation:"workspace@3"});
