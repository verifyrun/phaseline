// Reduced ordered multi-valued decision diagrams. Terminals 0 and 1 denote
// false and true. Each level tests a declared input with a fixed finite domain.
// Equal successor lists have one node. A test with all equal results disappears.
export class DecisionDiagram {
  constructor(widths, allowance={nodes:0, edges:0, calls:0}, charge=()=>{}, limits={}) {
    this.charge=charge;
    // Rule comparison keeps the small default so a poor order holds quickly. A caller
    // with no faster alternative, such as retention, can state a larger ceiling.
    this.limits={nodes:100000, edges:1000000, calls:500000, ...limits};
    if (widths.some(width=>!Number.isSafeInteger(width) || width<1)) throw Error("Invalid finite domain.");
    this.widths=widths;
    this.allowance=allowance;
    this.nodes=[null,null];
    this.unique=new Map();
    this.cache=new Map();
  }

  make(level, branches) {
    this.charge(branches.length+1);
    if (branches.length!==this.widths[level]) throw Error("Invalid decision node arity.");
    const first=branches[0];
    if (branches.every(value=>value===first)) return first;
    const key=level+":"+branches.join(",");
    const known=this.unique.get(key);
    if (known!==undefined) return known;
    this.allowance.nodes++;
    this.allowance.edges+=branches.length;
    if (this.allowance.nodes>this.limits.nodes || this.allowance.edges>this.limits.edges)
      throw Error("Symbolic state budget exhausted. Try the explicit Z3 backend for a rule comparison.");
    const index=this.nodes.length;
    this.nodes.push({level, branches}); this.unique.set(key,index);
    return index;
  }

  ite(condition, yes, no) {
    this.charge(1);
    if (condition===1 || yes===no) return yes;
    if (condition===0) return no;
    if (yes===1 && no===0) return condition;
    const key=condition+","+yes+","+no;
    const seen=this.cache.get(key);
    if (seen!==undefined) return seen;
    if (++this.allowance.calls>this.limits.calls)
      throw Error("Symbolic operation budget exhausted. Try the explicit Z3 backend for a rule comparison.");
    const nodes=[this.nodes[condition],this.nodes[yes],this.nodes[no]];
    const level=Math.min(...nodes.map(node=>node?.level??Infinity));
    const branches=[];
    for(let value=0;value<this.widths[level];value++) {
      const c=nodes[0]?.level===level?nodes[0].branches[value]:condition;
      const a=nodes[1]?.level===level?nodes[1].branches[value]:yes;
      const b=nodes[2]?.level===level?nodes[2].branches[value]:no;
      branches.push(this.ite(c,a,b));
    }
    const result=this.make(level,branches);
    this.cache.set(key,result);
    return result;
  }

  and(a,b) { return this.ite(a,b,0); }
  or(a,b) { return this.ite(a,1,b); }
  not(a) { return this.ite(a,0,1); }
  xor(a,b) { return this.ite(a,this.not(b),b); }

  // Fix one input to one value. The input no longer appears in the result.
  restrict(root, level, value) {
    const seen=new Map();
    const visit=index=>{
      if (index<2) return index;
      const node=this.nodes[index];
      if (node.level>level) return index;
      if (node.level===level) return node.branches[value];
      if (!seen.has(index)) seen.set(index,this.make(node.level,node.branches.map(visit)));
      return seen.get(index);
    };
    return visit(root);
  }

  first(root) {
    if (!root) return undefined;
    const result=Array(this.widths.length).fill(0);
    while (root!==1) {
      const {level,branches}=this.nodes[root];
      const next=branches.findIndex(node=>node!==0);
      result[level]=next;
      root=branches[next];
    }
    return result;
  }
}

// The same compilation works for independently declared Boolean variables and
// the exact integer cut representatives already shared by the two editions.
export function compileAnswers(diagram, edition, axes, levelOf=i=>i) {
  const variables=new Map(axes.map(([name,values],i)=>[name,{level:levelOf(i),values}]));
  const names=new Map();
  function expression(n) {
    if (n.op==="literal") return Number(n.value);
    if (n.op==="not") return diagram.not(expression(n.left));
    if (n.op==="and") return diagram.and(expression(n.left),expression(n.right));
    if (n.op==="or") return diagram.or(expression(n.left),expression(n.right));
    if (n.op==="name" && edition.rules.has(n.id)) return answer(n.id);
    const axis=variables.get(n.id);
    if (!axis) throw Error("Undeclared diagram input "+n.id);
    return diagram.make(axis.level,axis.values.map(value=>{
      if(n.op==="name") return Number(value);
      switch(n.operator) {
        case "=": return Number(value===n.amount);
        case "<": return Number(value<n.amount);
        case "<=": return Number(value<=n.amount);
        case ">": return Number(value>n.amount);
        case ">=": return Number(value>=n.amount);
        default: throw Error("Unknown predicate in decision diagram.");
      }
    }));
  }
  function answer(name) {
    if (!edition.rules.has(name)) return 0;
    if (!names.has(name)) names.set(name,expression(edition.rules.get(name)));
    return names.get(name);
  }
  return answer;
}
