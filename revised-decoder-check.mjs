import assert from "node:assert/strict";
import {nextAddress, packOrder, unpackOrder, width} from "./revised-decoder.mjs";

function* positions(values) {
  if (!values.length) { yield []; return; }
  for (const first of values) {
    for (const rest of positions(values.filter(x => x !== first))) yield [first, ...rest];
  }
}

let orders = 0, liveTables = 0, swaps = 0;
for (let n = 2; n <= 7; n++) {
  const slots = Array.from({length:n}, (_,i) => i);
  const encodings = new Set();
  for (const old of positions(slots)) {
    const data = packOrder(old);
    assert.deepEqual(unpackOrder(n, data), old);
    encodings.add(data.toString("hex"));
    orders++;
    if (n > 5) continue;
    for (const target of slots) {
      const inspect = nextAddress(old,target,slots);
      for (const left of slots) for (const right of slots.slice(left)) {
        const live = [...old];
        [live[left],live[right]] = [live[right],live[left]];
        let r = nextAddress(old,target,slots,live[inspect.slot]);
        if (r.status === "inspect_terminal") r = nextAddress(old,target,slots,live[inspect.slot],live[r.slot]);
        assert.equal(r.status,"confirmed");
        assert.equal(live[r.slot],target);
        swaps++;
      }
      if (n > 4) continue;
      for (let i=0; i<(n+1)**n; i++) {
        let state=i;
        const live=slots.map(() => {const v=state%(n+1); state=Math.floor(state/(n+1)); return v-1;});
        let r=nextAddress(old,target,slots,live[inspect.slot]);
        if (r.status==="inspect_terminal") r=nextAddress(old,target,slots,live[inspect.slot],live[r.slot]);
        if (r.status==="confirmed") assert.equal(live[r.slot],target);
        else assert.equal(r.status,"hold");
        liveTables++;
      }
    }
  }
  assert.equal(String(encodings.size),width(n).states);
}
assert.throws(() => packOrder([0,0,2]));
assert.throws(() => unpackOrder(3,Buffer.from([6])));
assert.throws(() => unpackOrder(4,Buffer.alloc(2)));
const large=Array.from({length:64},(_,i)=>63-i);
assert.deepEqual(unpackOrder(64,packOrder(large)),large);
assert.equal(nextAddress([1,0,2],1,[1,2],1).status,"hold");
console.log(JSON.stringify({orders,swaps,arbitraryTablesAndTargets:liveTables,largestRoundTrip:64}));
