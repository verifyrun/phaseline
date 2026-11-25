// Fixed-width encoding of a partial map. Every differently valued domain point
// can be the observer's next question. The public key and value orders are fixed.
export class MemoryError extends Error {}
export class MemoryLimit extends MemoryError {}
export function memoryMeter(limit) {
  if (!Number.isSafeInteger(limit) || limit<0 || limit>100_000_000) throw new MemoryError("Invalid memory computation allowance.");
  return {used:0,charge(units=1) {
    if (units>limit-this.used) throw new MemoryLimit("memory computation allowance exhausted");
    this.used+=units;
  }};
}
function integer(v) {
  if (typeof v==="bigint") return v;
  if (Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v==="string" && /^(0|[1-9][0-9]{0,20})$/.test(v)) return BigInt(v);
  throw new MemoryError("Supply an exact nonnegative integer.");
}
function choose(n,select,meter) {
  if (n<BigInt(select)) return 0n;
  let acc=1n;
  for (let i=1;i<=select;i++) {
    meter.charge();
    acc=acc*(n-BigInt(i-1))/BigInt(i);
  }
  return acc;
}
export function memoryCodebook(keys,labels,cap,meter) {
  const n=integer(keys),l=integer(labels);
  if (n<0n || n>2n**64n || l<1n || l>2n**32n || !Number.isSafeInteger(cap) ||
      cap<0 || cap>128 || BigInt(cap)>n) throw new MemoryError("Unsupported earned memory dimensions.");
  // offsets[j] starts the fixed-size subset band for j acquired readings.
  const offsets=[],powers=[];
  let states=0n, combinations=1n, power=1n;
  for (let j=0;j<=cap;j++) {
    meter.charge();
    offsets.push(states);powers.push(power);
    states+=combinations*power;
    combinations=combinations*(n-BigInt(j))/BigInt(j+1);
    power*=l;
  }
  const bits=states===1n?0:(states-1n).toString(2).length;
  return {n,l,cap,states,bits,bytes:Math.ceil(bits/8),offsets,powers};
}
export function encodeMemory(book,entries,meter) {
  if (!Array.isArray(entries) || entries.length>book.cap) throw new MemoryError("Acquired observations exceed the contracted capacity.");
  const cells=entries.map(c=>{
    meter.charge();
    if (!Array.isArray(c) || c.length!==2) throw new MemoryError("Invalid earned memory entry.");
    return [integer(c[0]),integer(c[1])];
  });
  cells.sort((a,b)=>{meter.charge();return a[0]<b[0]?-1:a[0]>b[0]?1:0;});
  let subset=0n,word=0n;
  for (const [i,[k,v]] of cells.entries()) {
    meter.charge();
    if (k<0n || k>=book.n || v<0n || v>=book.l || (i && cells[i-1][0]===k))
      throw new MemoryError("Duplicate or out-of-domain earned memory entry.");
    subset+=choose(k,i+1,meter);
    word=word*book.l+v;
  }
  const rank=book.offsets[cells.length]+subset*book.powers[cells.length]+word;
  const bytes=Buffer.alloc(book.bytes);
  let value=rank;
  for(let i=bytes.length-1;i>=0;i--) {meter.charge();bytes[i]=Number(value&255n);value>>=8n;}
  return bytes;
}
export function decodeMemory(book,bytes,meter) {
  if (!(bytes instanceof Uint8Array) || bytes.length!==book.bytes) throw new MemoryError("Earned memory has the wrong width.");
  let rank=0n;
  for (const byte of bytes) {meter.charge();rank=(rank<<8n)|BigInt(byte);}
  if (rank>=book.states) throw new MemoryError("Unused earned memory rank.");
  let count=book.cap;
  while (rank<book.offsets[count]) {meter.charge();count--;}
  const residue=rank-book.offsets[count], power=book.powers[count];
  let subset=residue/power,answers=residue%power,upper=book.n;
  const rows=Array(count);
  for(let j=count;j>0;j--) {
    // Largest k below the next selected key with C(k,j) <= the residual rank.
    let lo=BigInt(j-1),hi=upper;
    while (hi-lo>1n) {
      meter.charge();
      const mid=(lo+hi)>>1n;
      if (choose(mid,j,meter)<=subset) lo=mid;
      else hi=mid;
    }
    rows[j-1]=[lo,answers%book.l];
    answers/=book.l;
    subset-=choose(lo,j,meter);
    upper=lo;
  }
  return rows;
}
