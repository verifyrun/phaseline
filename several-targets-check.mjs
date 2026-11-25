import assert from "node:assert/strict";
import {bundleWidth,nextBundle,openBundle,packBundle} from "./several-targets.mjs";

function* permutations(labels) {
  if(!labels.length) {yield [];return;}
  for(const name of labels)for(const tail of permutations(labels.filter(v=>v!==name)))yield [name,...tail];
}
function visit(plan,table,offer) {
  const seen=[];
  for(;;) {
    const next=nextBundle(plan,seen,offer);
    if(next.status!=="inspect_bundle")return {next,seen};
    assert.ok(seen.length<plan.cap && !seen.some(r=>r.slot===next.slot));
    seen.push({slot:next.slot,label:table[next.slot]});
  }
}
let covered=0,arbitrary=0,codes=0;
for(let n=2;n<=6;n++) {
  const slots=Array.from({length:n},(_,i)=>i);
  for(let k=1;k<=n;k++) {
    const targets=slots.slice(n-k).reverse(),book=bundleWidth(n,targets),ranks=new Set();
    for(const old of permutations(slots)) {
      const bytes=packBundle(old,targets),key=bytes.toString("hex");
      const plan=openBundle(n,targets,bytes);
      ranks.add(key);
      for(let i=0;i<n;i++)for(let j=i;j<n;j++) {
        const live=[...old];[live[i],live[j]]=[live[j],live[i]];
        const {next,seen}=visit(plan,live,slots);
        assert.deepEqual(next,{status:"confirmed",slots:targets.map(label=>live.indexOf(label))});
        assert.ok(seen.length<=book.queries);covered++;
      }
      if(n>4)continue;
      for(let pattern=0;pattern<(n+1)**n;pattern++) {
        let v=pattern;
        const live=slots.map(()=>{const x=v%(n+1)-1;v=Math.floor(v/(n+1));return x;});
        const offer=pattern%2?slots:slots.slice(1);
        const {next,seen}=visit(plan,live,offer);
        if(next.status==="confirmed")for(const [i,at] of next.slots.entries()) {
          assert.ok(offer.includes(at) && seen.some(r=>r.slot===at && r.label===targets[i]));
          assert.equal(live[at],targets[i]);
        } else assert.equal(next.status,"hold");
        arbitrary++;
      }
    }
    assert.equal(String(ranks.size),book.states);codes+=ranks.size;
  }
}
assert.throws(()=>packBundle([0,1,1,3],[0,1]));
assert.throws(()=>openBundle(4,[1,0],Buffer.from([12])));
assert.deepEqual(bundleWidth(4,[0,1,2]),{bits:0,bytes:0,states:"1",kept:0,queries:4});
assert.equal(bundleWidth(64,[0,63]).bytes,37);
console.log(JSON.stringify({coveredSwapsAndTargetSets:covered,arbitraryTablesWithOffers:arbitrary,distinctCodes:codes}));
