// Exact origin enumeration for Boolean clauses with unit propagation.
// null means this representation does not cover the given formula.
export function clauseOrigins(model,retained,spend,visit) {
  const widths=model.variables;
  if(widths.some(w=>w>2))return null;
  const clauses=[], units=[];
  const stats={method:"watched_clauses",clauses:0,branchPoints:0,forced:0};
  let impossible=false;
  function literal(f) {
    spend();
    if(typeof f==="boolean")return f;
    if(Array.isArray(f)) {
      const [i,value]=f;
      return widths[i]===1 ? value===0 : value===1?i+1:-(i+1);
    }
    if(Object.hasOwn(f,"not")) {
      const a=literal(f.not);
      return a===undefined?undefined:typeof a==="boolean"?!a:-a;
    }
  }
  function flattenedAny(f,list) {
    spend();
    if(f && Object.hasOwn(f,"any"))return f.any.every(c=>flattenedAny(c,list));
    const a=literal(f);
    if(a===undefined)return false;
    list.push(a);return true;
  }
  function addClause(parts) {
    const seen=new Set();
    for(const value of parts) {
      spend();
      if(value===true || (typeof value==="number" && seen.has(-value)))return;
      if(value!==false)seen.add(value);
    }
    const c=[...seen];
    stats.clauses++;
    if(!c.length)impossible=true;
    else if(c.length===1)units.push(c[0]);
    else clauses.push(c);
  }
  const inverse=x=>typeof x==="boolean"?!x:-x;
  function conjunct(f) {
    spend();
    if(f && Object.hasOwn(f,"all"))return f.all.every(conjunct);
    if(f && Object.hasOwn(f,"one")) {
      if(f.one.length>32)return false;
      const xs=f.one.map(literal);
      if(xs.some(x=>x===undefined))return false;
      addClause(xs);
      for(let i=0;i<xs.length;i++)for(let j=0;j<i;j++)addClause([inverse(xs[i]),inverse(xs[j])]);
      return true;
    }
    const list=[];
    if(!flattenedAny(f,list))return false;
    addClause(list);return true;
  }
  if(!conjunct(model.initial))return null;
  if(impossible)return stats;
  const n=widths.length;
  const watches=Array.from({length:2*n+1},()=>[]);
  const values=new Int8Array(n+1), trail=[];
  for(const c of clauses) {watches[c[0]+n].push(c);watches[c[1]+n].push(c);spend(2);}
  const value=lit=>lit>0?values[lit]:-values[-lit];
  function bind(lit) {
    const v=value(lit);
    if(v!==0)return v===1;
    values[Math.abs(lit)]=lit>0?1:-1;
    trail.push(lit);return true;
  }
  function propagate(head) {
    while(head<trail.length) {
      const no=-trail[head++],bucket=watches[no+n];
      let i=0;
      while(i<bucket.length) {
        spend();
        const c=bucket[i];
        if(c[0]===no)[c[0],c[1]]=[c[1],c[0]];
        if(c[1]!==no)throw Error("Origin clause watch lost its literal.");
        if(value(c[0])===1){i++;continue;}
        let k=2;
        while(k<c.length) {spend();if(value(c[k])!==-1)break;k++;}
        if(k<c.length) {
          [c[1],c[k]]=[c[k],c[1]];
          watches[c[1]+n].push(c);
          bucket[i]=bucket[bucket.length-1];bucket.pop();
        } else {
          if(!bind(c[0]))return false;
          stats.forced++;i++;
        }
      }
    }
    return true;
  }
  for(const [i,width] of widths.entries()) {
    if((width===1 || (retained && !retained.has(i)))&&!bind(-(i+1)))return stats;
  }
  for(const lit of units)if(!bind(lit))return stats;
  function branch(start) {
    spend();
    while(start<=n && values[start]!==0)start++;
    if(start>n) {visit(Array.from(values.slice(1),v=>Number(v===1)));return;}
    const saved=trail.length;
    stats.branchPoints++;
    for(const lit of [-start,start]) {
      bind(lit);
      if(propagate(saved))branch(start+1);
      while(trail.length>saved)values[Math.abs(trail.pop())]=0;
    }
  }
  if(propagate(0))branch(1);
  return stats;
}
