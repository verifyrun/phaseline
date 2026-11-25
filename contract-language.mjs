// An edition is a directed acyclic graph of named Boolean outcomes. Numeric
// predicates have constant truth values between successive integer boundaries.
const identifier = /^[a-z][a-z0-9_]{0,39}$/;
const unitName = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const reserved = new Set(["true","false","when","unless","or","and","not","fact","guarantee"]);
const operators = new Set(["<","<=",">",">=","="]);
const maxInteger = Number.MAX_SAFE_INTEGER;
// Imported by legacy editions which used this quantity without giving a domain.
// An explicit declaration can use the same name for any unit and range.
const legacyQuantities = new Map([["order_total", {unit:"USD_cents", range:[1,999999999]}]]);

function quantityRange(id, binding) {
  if (binding?.range) return binding.range;
  const legacy = legacyQuantities.get(id);
  if (legacy && (!binding || binding.unit === legacy.unit)) return legacy.range;
  return [0,maxInteger];
}

function validId(id) { return identifier.test(id) && !reserved.has(id); }
function syntax(message) { throw Error(message); }

function expression(text) {
  const lex = /\s*(>=|<=|[()=<>]|[A-Za-z_][A-Za-z_0-9]*|-?[0-9]+)/y;
  const tokens=[];
  while (lex.lastIndex < text.length) {
    const from=lex.lastIndex, part=lex.exec(text);
    if (tokens.length>=4096) syntax("A condition can have at most 4,096 words and symbols.");
    if (!part) syntax("Unexpected "+JSON.stringify(text.slice(from).trim()[0]??"")+". A condition uses names, and, or, not, unless, parentheses and comparisons with a whole number such as amount <= 100 USD_cents. There is no !=, arithmetic or list.");
    tokens.push(part[1]);
  }
  let pos=0;
  function take(word) { if(tokens[pos]!==word) return false; pos++; return true; }
  function atom() {
    if(take("not")) return {op:"not",left:atom()};
    if(take("(")) {
      const nested=condition();
      if(!take(")")) syntax("Expected a closing parenthesis.");
      return nested;
    }
    const id=tokens[pos++];
    if(id==="true" || id==="false") return {op:"literal",value:id==="true"};
    if(!id || !validId(id)) syntax("Expected a fact, a guarantee, or a parenthesized condition.");
    if(!operators.has(tokens[pos])) return {op:"name",id};
    const operator=tokens[pos++], raw=tokens[pos++], unit=tokens[pos++];
    if(!/^-?[0-9]+$/.test(raw??"") || !Number.isSafeInteger(Number(raw)) || !unitName.test(unit??""))
      syntax("Compare with an exact whole number and its declared unit, such as amount <= 100 USD_cents. A fact cannot be compared with another fact or with text.");
    return {op:"compare",id,operator,amount:Number(raw),unit};
  }
  function joined(next,word) {
    let terms=[next()];
    while(take(word)) terms.push(next());
    // Associative runs can be wide. Keep the tree shallow for every backend.
    while(terms.length>1) {
      const pairs=[];
      for(let i=0;i<terms.length;i+=2)
        pairs.push(i+1===terms.length?terms[i]:{op:word,left:terms[i],right:terms[i+1]});
      terms=pairs;
    }
    return terms[0];
  }
  const conjunction=()=>joined(atom,"and");
  const disjunction=()=>joined(conjunction,"or");
  function condition() {
    const left=disjunction();
    return take("unless") ? {op:"and",left,right:{op:"not",left:disjunction()}} : left;
  }
  const tree=condition();
  if(pos!==tokens.length) syntax("Unexpected token "+tokens[pos]+"."+(/^(and|or|not|unless)$/i.test(tokens[pos])&&tokens[pos]!==tokens[pos].toLowerCase()?" Write "+tokens[pos].toLowerCase()+" in lowercase.":""));
  return tree;
}

export function readEdition(source) {
  if(typeof source!=="string" || !source.trim() || source.length>200000)
    syntax("Supply an edition of 1–200,000 characters.");
  const rules=new Map(), bindings=new Map(), used=new Set();
  for(const [index,raw] of source.split(/\r?\n/).entries()) {
    const line=raw.trim();
    // A line that starts with # is a note for readers and changes nothing.
    if(!line || line.startsWith("#")) continue;
    try {
      if(line.startsWith("fact ")) {
        const match=/^fact (\w+)(?: in (\w+)(?: range (-?\d+)\.\.(-?\d+))?)? from (\w+)\.(\w+) owner (\w+)(?: missing hold_dependents)?(?: (latest|standing)( at event)?)?(?: within (\d+))?$/.exec(line);
        if(!match) syntax("Use fact name [in unit [range min..max]] from record.field owner role [missing hold_dependents] [latest, standing or standing at event] [within N].");
        const [,id,unit,min,max,record,field,owner,mode,atEvent,within]=match;
        if(atEvent && mode!=="standing") syntax("Write at event only after standing.");
        if(within!==undefined && !(Number.isSafeInteger(Number(within)) && Number(within)>0))
          syntax("After within, give a whole number of time units greater than zero.");
        if(![id,record,field,owner].every(validId) || (unit && !unitName.test(unit)) || bindings.has(id))
          syntax("Invalid or repeated fact declaration: "+id);
        const range=min === undefined ? undefined : [Number(min),Number(max)];
        if(range && (!range.every(Number.isSafeInteger) || range[0]>range[1]))
          syntax("Supply an inclusive range of exact safe integers in ascending order.");
        bindings.set(id,{source:record+"."+field,owner,...(unit?{unit}:{}),...(range?{range}:{}),...(mode?{[mode]:true}:{}),...(atEvent?{atEvent:true}:{}),...(within!==undefined?{within:Number(within)}:{})});
      } else {
        if(!line.startsWith("guarantee "))
          syntax("Start each line with fact, guarantee or # for a note, in lowercase and separated by single spaces.");
        const match=/^guarantee (\w+) when (.+)$/.exec(line);
        if(!match || !validId(match[1])) syntax("Use guarantee name when condition.");
        if(rules.has(match[1])) syntax("Repeated guarantee: "+match[1]);
        if(rules.size>=128) syntax("Use at most 128 distinct guarantees per edition.");
        rules.set(match[1],expression(match[2]));
      }
    } catch(error) {throw Error("Line "+(index+1)+": "+error.message);}
  }
  if(!rules.size) syntax("Declare at least one guarantee.");
  const fields=new Map();
  for(const [id,binding] of bindings) {
    if(rules.has(id)) syntax("A fact and guarantee share the name "+id);
    const key=binding.source+"@"+binding.owner;
    if(fields.has(key)) syntax("Use one fact name for "+key+"; "+fields.get(key)+" already names it.");
    fields.set(key,id);
  }
  const dependencies=new Map(), visiting=new Set();
  const type=id=>(bindings.get(id) ?? legacyQuantities.get(id))?.unit;
  const range=id=>quantityRange(id,bindings.get(id));
  function forRule(id) {
    if(dependencies.has(id)) return dependencies.get(id);
    if(visiting.has(id)) syntax("Guarantees contain a circular reference at "+id);
    visiting.add(id);
    const parts=new Map();
    function add(fact,cuts) {
      used.add(fact);
      if(!parts.has(fact)) parts.set(fact,new Set());
      for(const value of cuts) parts.get(fact).add(value);
    }
    function visit(node) {
      if(node.op==="name") {
        if(rules.has(node.id)) for(const [key,cuts] of forRule(node.id)) add(key,cuts);
        else {
          if(type(node.id)) syntax("Compare "+node.id+" with a quantity in "+type(node.id)+".");
          add(node.id,[]);
        }
      } else if(node.op==="compare") {
        const {id:fact,amount,unit,operator}=node;
        if(type(fact)!==unit) syntax("Use the declared unit for "+fact+" (fact "+fact+" in "+unit+" from …).");
        const [,max]=range(fact);
        // Explicit domains allow thresholds outside the domain (a constant answer).
        // Legacy quantity checks preserve their historical source-validation behavior.
        if(!bindings.get(fact)?.range && (amount>max || amount<0)) syntax("Threshold exceeds the supported range for "+fact+".");
        const cuts=[];
        if(["=","<",">="].includes(operator)) cuts.push(amount);
        if(["=","<=",">"].includes(operator) && amount<max) cuts.push(amount+1);
        add(fact,cuts);
      } else {
        if(node.left) visit(node.left);
        if(node.right) visit(node.right);
      }
    }
    visit(rules.get(id)); visiting.delete(id); dependencies.set(id,parts); return parts;
  }
  for(const id of rules.keys()) forRule(id);
  return {rules,bindings,fields,used,dependencies,type,range};
}

export function evaluate(edition,id,inputs,cache=new Map()) {
  if(!edition.rules.has(id)) return false;
  if(cache.has(id)) return cache.get(id);
  function resolve(n) {
    switch(n.op) {
      case "literal": return n.value;
      case "and": return resolve(n.left) && resolve(n.right);
      case "or": return resolve(n.left) || resolve(n.right);
      case "not": return !resolve(n.left);
      case "name": return edition.rules.has(n.id)?evaluate(edition,n.id,inputs,cache):inputs[n.id];
      case "compare": {
        const a=inputs[n.id],b=n.amount;
        switch(n.operator) {case "<":return a<b; case "<=":return a<=b; case ">":return a>b; case ">=":return a>=b; case "=":return a===b;}
      }
    }
  }
  const value=resolve(edition.rules.get(id));
  cache.set(id,value); return value;
}

export function partitions(id,editions,known=new Map()) {
  const cuts=new Map();
  for(const edition of editions) for(const [key,points] of edition.dependencies.get(id)??[]) {
    if(!cuts.has(key)) cuts.set(key,new Set());
    for(const value of points) cuts.get(key).add(value);
  }
  // Prefer small amounts and witnesses that do not require a newly introduced
  // Boolean fact. Stable ordering makes the reported example reproducible.
  function priority(key) {
    if(editions.some(edition=>edition.type(key))) return 0;
    return editions[0].used.has(key)?2:1;
  }
  const keys=[...cuts.keys()].sort((a,b)=>priority(a)-priority(b) || a.localeCompare(b,"en"));
  return keys.map(key=>{
    if(known.has(key)) return [key,[known.get(key)]];
    if(!editions.some(e=>e.type(key))) return [key,[false,true]];
    const typed=editions.find(e=>e.type(key));
    const [low,high]=typed.range(key);
    const values=new Set([low,...[...cuts.get(key)].filter(x=>x>=low && x<=high)]);
    return [key,[...values].sort((a,b)=>a-b)];
  });
}

// Charge the full partition before searching for the first difference. A refusal
// applies to the entire operation, even if a previous guarantee was cheap.
export function worlds(axes,budget,callback) {
  let count=1;
  for(const [,values] of axes) {
    count*=values.length;
    if(count>65536) syntax("Comparison budget exceeded: more than 65,536 combinations for one guarantee.");
  }
  budget.used+=count;
  if(budget.used>1000000) syntax("Comparison budget exceeded: more than 1,000,000 combinations across guarantees.");
  const inputs=Object.create(null);
  for(const [key] of axes) inputs[key]=undefined;
  for(let row=0;row<count;row++) {
    let code=row;
    for(let i=axes.length-1;i>=0;i--) {
      const [key,values]=axes[i];
      inputs[key]=values[code%values.length]; code=Math.floor(code/values.length);
    }
    if(callback(inputs)===false) break;
  }
}

export function validObservation(fact, binding, value) {
  if (!binding.unit) return typeof value === "boolean";
  if (!Number.isSafeInteger(value)) return false;
  const [low,high]=quantityRange(fact,binding);
  return value >= low && value <= high;
}
