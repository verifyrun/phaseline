// Fixed-width payload for a known target set. The remaining positions are an
// ordered sample without replacement. An old target's individual position is unnecessary.
import {need} from "./review-journal.mjs";

const range=n=>Array.from({length:n},(_,i)=>i);

export function bundleWidth(n,targets) {
  need(Number.isInteger(n) && n>=2 && n<=64 && Array.isArray(targets) && targets.length>0 &&
    targets.every(i=>Number.isInteger(i) && i>=0 && i<n) && new Set(targets).size===targets.length,
    "the dictionary needs a nonempty set of distinct, admissible target labels");
  const k=targets.length, kept=n-k>=2?n-k:0;
  let states=1n;
  for(let i=0;i<kept;i++)states*=BigInt(n-i);
  const bits=states===1n?0:(states-1n).toString(2).length;
  return {bits,bytes:Math.ceil(bits/8),states:states.toString(),kept,queries:Math.min(n,k+1)};
}

export function packBundle(order,targets) {
  const book=bundleWidth(order.length,targets),n=order.length;
  need(order.every(i=>Number.isInteger(i)&&i>=0&&i<n) && new Set(order).size===n,
    "the acquired historical dictionary is not a permutation of the granted alphabet");
  const slots=range(n),others=range(n).filter(label=>!targets.includes(label));
  let rank=0n;
  for(const label of others.slice(0,book.kept)) {
    const digit=slots.indexOf(order.indexOf(label));
    rank=rank*BigInt(slots.length)+BigInt(digit);
    slots.splice(digit,1);
  }
  const bytes=Buffer.alloc(book.bytes);
  for(let i=bytes.length-1;i>=0;i--) {bytes[i]=Number(rank&255n); rank>>=8n;}
  return bytes;
}

export function openBundle(n,targets,bytes) {
  const book=bundleWidth(n,targets);
  need(bytes instanceof Uint8Array && bytes.length===book.bytes,"wrong retained width for the agreed target set");
  let rank=0n;
  for(const byte of bytes)rank=(rank<<8n)|BigInt(byte);
  need(rank<BigInt(book.states),"unused code for the retained target set");
  const digits=[];
  for(let i=book.kept-1;i>=0;i--) {
    const radix=BigInt(n-i);
    digits.unshift(Number(rank%radix));rank/=radix;
  }
  const remaining=range(n),otherLabels=range(n).filter(i=>!targets.includes(i));
  const known=Array(n).fill(null);
  digits.forEach((digit,i)=>{const [slot]=remaining.splice(digit,1); known[slot]=otherLabels[i];});
  return {known,first:remaining,targets:[...targets],cap:book.queries};
}

// Evidence order and the consuming snapshot are checked by the calling port.
// A successful result lists only positions with actual current affirmative reads.
export function nextBundle(plan,observations,offer) {
  const found=new Map(),used=new Set(),unexpected=new Set();
  for(const {slot,label} of observations) {
    need(Number.isInteger(slot) && slot>=0 && slot<plan.known.length && !used.has(slot),"a current slot was repeated or invalid");
    used.add(slot);
    if(plan.targets.includes(label)) {
      if(offer.includes(slot) && !found.has(label))found.set(label,slot);
    } else unexpected.add(label);
  }
  if(found.size===plan.targets.length)return {status:"confirmed",slots:plan.targets.map(t=>found.get(t))};
  const first=plan.first.find(i=>!used.has(i));
  if(first!==undefined && used.size<plan.cap)return {status:"inspect_bundle",slot:first};
  if(used.size<plan.cap && unexpected.size===1) {
    const [label]=unexpected;
    const slot=plan.known.indexOf(label);
    if(slot>=0 && !used.has(slot))return {status:"inspect_bundle",slot};
  }
  return {status:"hold",reason:"the current paid readings do not confirm every target at an offered slot",confirmed:found.size,required:plan.targets.length};
}
