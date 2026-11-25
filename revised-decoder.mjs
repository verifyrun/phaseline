// A historical permutation and a current confirmation answer different questions.
import {need} from "./review-journal.mjs";
function count(n) { let v=1n;for(let i=2;i<=n;i++)v*=BigInt(i);return v; }
export function width(n) {
  need(Number.isSafeInteger(n) && n>=2 && n<=64,"unsupported dictionary dimension");
  const states=count(n),bits=(states-1n).toString(2).length;
  return {bits,bytes:Math.ceil(bits/8),states:states.toString()};
}
export function packOrder(order) {
  const n=order.length,book=width(n);let rank=0n;
  const remaining=Array.from({length:n},(_,i)=>i);
  for(const label of order) {
    const digit=remaining.indexOf(label);
    need(digit>=0,"the actual historical dictionary is not a permutation of the granted alphabet");
    rank=rank*BigInt(remaining.length)+BigInt(digit);remaining.splice(digit,1);
  }
  const bytes=Buffer.alloc(book.bytes);
  for(let i=bytes.length-1;i>=0;i--) {bytes[i]=Number(rank&255n);rank>>=8n;}
  return bytes;
}
export function unpackOrder(n,bytes) {
  const book=width(n);
  need(bytes instanceof Uint8Array && bytes.length===book.bytes,"wrong retained dictionary width");
  let rank=0n;for(const byte of bytes)rank=(rank<<8n)|BigInt(byte);
  need(rank<BigInt(book.states),"unused historical dictionary rank");
  const digits=[];
  for(let radix=1;radix<=n;radix++) {
    digits.push(Number(rank%BigInt(radix)));rank/=BigInt(radix);
  }
  const remaining=Array.from({length:n},(_,i)=>i);
  return digits.reverse().map(digit=>remaining.splice(digit,1)[0]);
}
// Negative sentinels distinguish absence of an observation from a real JSON null.
// Arguments are already indices into the declared alphabet. -1 denotes an unknown live label.
export function nextAddress(order,target,offer,first,confirmation) {
  const start=order.indexOf(target);
  need(start!==-1,"the target is missing from the historical dictionary");
  if(first===undefined)return {status:"inspect_first",slot:start};
  const candidate=first===target?start:order.indexOf(first);
  if(candidate<0)return {status:"hold",reason:"the current label falls outside the historical alphabet"};
  if(!offer.includes(candidate))return {status:"hold",reason:"the terminal address is outside the delivery grant"};
  if(first===target)return {status:"confirmed",slot:start};
  if(confirmation===undefined)return {status:"inspect_terminal",slot:candidate};
  return confirmation===target?{status:"confirmed",slot:candidate}:
    {status:"hold",reason:"the actual terminal address no longer delivers the pending value"};
}
